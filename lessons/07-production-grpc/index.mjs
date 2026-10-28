// LESSON 7: what a real gRPC service adds on top of the hello world.
//
// Three things every production gRPC call has, one step each:
//   1. DEADLINES: the client gives up after N ms. Does the server stop too?
//   2. STATUS CODES: the code tells the client whether a retry can help.
//   3. METADATA + INTERCEPTORS: request ids and auth added once, for every call.
// Run one step at a time: node lessons/07-production-grpc/index.mjs 1
import crypto from 'node:crypto';
import grpc from '@grpc/grpc-js';
import { setTimeout as sleep } from 'node:timers/promises';
import { rides } from '../../src/proto.mjs';
import { heading } from '../../src/harness/report.mjs';

const QUOTE = { origin: { lat: 6.2, lng: -75.5 }, dest: { lat: 6.25, lng: -75.6 }, product: 'x' };

const startPricing = (Quote) => startService(rides.Pricing.service, { Quote });

async function startService(service, handlers) {
  const server = new grpc.Server();
  server.addService(service, handlers);
  const port = await new Promise((ok, fail) =>
    server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (err, p) => (err ? fail(err) : ok(p))),
  );
  return { server, address: `127.0.0.1:${port}` };
}

// Promise wrapper around a unary call; returns { reply } or { error }.
const quote = (client, request, options = {}) =>
  new Promise((ok) => client.Quote(request, options, (error, reply) => ok(error ? { error } : { reply })));

const codeName = (code) => Object.keys(grpc.status).find((k) => grpc.status[k] === code);

// ---- Step 1: deadlines ------------------------------------------------------
// The quote takes 300 ms (six 50 ms chunks). The client only waits 100 ms.
async function step1() {
  for (const checksCancel of [false, true]) {
    heading(checksCancel ? 'server checks call.cancelled between chunks' : 'server ignores the deadline');
    const start = performance.now();
    const t = () => `${Math.round(performance.now() - start)} ms`.padStart(6);

    const { server, address } = await startPricing(async (call, callback) => {
      for (let chunk = 1; chunk <= 6; chunk++) {
        if (checksCancel && call.cancelled) return console.log(`${t()}  server: client is gone, stopped after ${chunk - 1}/6 chunks`);
        await sleep(50);
      }
      console.log(`${t()}  server: finished all 6/6 chunks`);
      callback(null, { amount_cents: 1200, currency: 'COP', surge: 1 });
    });

    const client = new rides.Pricing(address, grpc.credentials.createInsecure());
    const { error } = await quote(client, QUOTE, { deadline: Date.now() + 100 });
    console.log(`${t()}  client: ${codeName(error.code)}`);

    await sleep(400); // give the server time to show what it does after the client left
    client.close();
    server.forceShutdown();
  }
}

// ---- Step 2: status codes decide retries ----------------------------------
// The server is down for the first 2 calls (UNAVAILABLE), and rejects an empty
// product (INVALID_ARGUMENT). The client retries only codes a retry can fix.
const RETRYABLE = new Set([grpc.status.UNAVAILABLE, grpc.status.DEADLINE_EXCEEDED]);

async function quoteWithRetries(client, request, maxAttempts = 4) {
  for (let attempt = 1; ; attempt++) {
    const result = await quote(client, request);
    const outcome = result.error ? codeName(result.error.code) : 'OK';
    console.log(`  attempt ${attempt}: ${outcome}`);
    if (!result.error || !RETRYABLE.has(result.error.code) || attempt === maxAttempts) return result;
    await sleep(20 * 2 ** attempt); // exponential backoff, as in lesson 6's reading
  }
}

async function step2() {
  let calls = 0;
  const { server, address } = await startPricing((call, callback) => {
    if (!call.request.product) return callback({ code: grpc.status.INVALID_ARGUMENT, details: 'product is required' });
    if (++calls <= 2) return callback({ code: grpc.status.UNAVAILABLE, details: 'warming up' });
    callback(null, { amount_cents: 1200, currency: 'COP', surge: 1 });
  });
  const client = new rides.Pricing(address, grpc.credentials.createInsecure());

  heading('server is warming up (UNAVAILABLE twice)');
  await quoteWithRetries(client, QUOTE);
  heading('bad request (empty product)');
  await quoteWithRetries(client, { ...QUOTE, product: '' });

  client.close();
  server.forceShutdown();
}

// ---- Step 3: metadata and interceptors ------------------------------------
// Metadata is gRPC's headers. An interceptor is client-side middleware: it runs
// on every call, so the calling code never mentions request ids or tokens.
const addRequestIdAndToken = (options, nextCall) =>
  new grpc.InterceptingCall(nextCall(options), {
    start(metadata, listener, next) {
      metadata.set('x-request-id', crypto.randomUUID().slice(0, 8));
      metadata.set('authorization', 'Bearer dev-token');
      next(metadata, listener);
    },
  });

async function step3() {
  const { server, address } = await startPricing((call, callback) => {
    const [requestId = '(none)'] = call.metadata.get('x-request-id');
    const [auth] = call.metadata.get('authorization');
    console.log(`  server: request ${requestId}, authorization: ${auth ?? '(none)'}`);
    if (auth !== 'Bearer dev-token') return callback({ code: grpc.status.UNAUTHENTICATED, details: 'missing token' });
    callback(null, { amount_cents: 1200, currency: 'COP', surge: 1 });
  });

  for (const withInterceptor of [false, true]) {
    heading(withInterceptor ? 'client with the interceptor' : 'plain client');
    const options = withInterceptor ? { interceptors: [addRequestIdAndToken] } : {};
    const client = new rides.Pricing(address, grpc.credentials.createInsecure(), options);
    const { error } = await quote(client, QUOTE); // the same call both times
    console.log(`  client: ${error ? codeName(error.code) : 'OK'}`);
    client.close();
  }
  server.forceShutdown();
}

// ---- Step 4: deadline propagation ------------------------------------------
// A chain: client -> Pricing -> ETA. The client waits 100 ms. ETA takes 300 ms
// and checks call.cancelled. What deadline does Pricing give its call to ETA?
async function step4() {
  for (const propagate of [false, true]) {
    heading(propagate ? 'pricing passes its own deadline down' : 'pricing gives ETA a fresh 1 s deadline');
    const start = performance.now();
    const t = () => `${Math.round(performance.now() - start)} ms`.padStart(6);

    const eta = await startService(rides.Eta.service, {
      Estimate: async (call, callback) => {
        for (let chunk = 1; chunk <= 6; chunk++) {
          if (call.cancelled) return console.log(`${t()}  eta: caller is gone, stopped after ${chunk - 1}/6 chunks`);
          await sleep(50);
        }
        console.log(`${t()}  eta: finished all 6/6 chunks`);
        callback(null, { seconds: 420 });
      },
    });
    const etaClient = new rides.Eta(eta.address, grpc.credentials.createInsecure());

    const pricing = await startPricing((call, callback) => {
      const deadline = propagate ? call.getDeadline() : Date.now() + 1000;
      etaClient.Estimate({ from: call.request.origin, to: call.request.dest }, { deadline }, (error, reply) =>
        callback(error, error ? undefined : { amount_cents: 1200 + reply.seconds, currency: 'COP', surge: 1 }),
      );
    });

    const client = new rides.Pricing(pricing.address, grpc.credentials.createInsecure());
    const { error } = await quote(client, QUOTE, { deadline: Date.now() + 100 });
    console.log(`${t()}  client: ${codeName(error.code)}`);

    await sleep(400);
    for (const c of [client, etaClient]) c.close();
    for (const s of [pricing, eta]) s.server.forceShutdown();
  }
}

const steps = { 1: step1, 2: step2, 3: step3, 4: step4 };
const step = steps[process.argv[2]];
if (!step) {
  console.log('usage: node lessons/07-production-grpc/index.mjs <1|2|3>');
  process.exit(1);
}
await step();
