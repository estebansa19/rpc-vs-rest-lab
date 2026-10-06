// PART 2: simulate the real thing.
//
// A "Dispatch" service handles a ride request by calling three other services,
// each running as its own OS process (like separate deployments):
//
//                      +--> Drivers.Nearby   (50 drivers around you)  --+
//   ride request --> Dispatch                                           +--> pick nearest
//                      +--> Pricing.Quote    (price + surge)          --+         |
//                                                                               v
//                                                              Eta.Estimate (driver -> you)
//
// Two parallel calls, then one dependent call: the shape of most real request
// paths. We run it over REST/JSON and over gRPC and compare.
import { startServices } from './lib/cluster.mjs';
import { makeClient } from './lib/clients.mjs';
import { makeRideRequest, haversineKm } from './lib/data.mjs';
import { summarize, fmtMs, fmtBytes, table, heading } from './lib/stats.mjs';

const WORK_MS = 3; // each service does ~3 ms of "real" work (DB lookup, cache miss...)
const TOTAL = 1500;
const CONCURRENCIES = [1, 25, 100];

async function dispatch(client, i) {
  const ride = makeRideRequest(i);
  const [near, quote] = await Promise.all([
    client.nearby({ origin: ride.origin, limit: 50 }),
    client.quote(ride),
  ]);
  const best = near.drivers
    .filter((d) => d.available)
    .reduce((a, b) => (haversineKm(a.location, ride.origin) <= haversineKm(b.location, ride.origin) ? a : b));
  const eta = await client.eta({ from: best.location, to: ride.origin });
  return { driver: best.id, price_cents: quote.amount_cents, surge: quote.surge, eta_s: eta.seconds };
}

async function load(client, concurrency, total) {
  const latencies = [];
  let next = 0;
  const started = performance.now();
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < total) {
        const i = next++;
        const t = performance.now();
        await dispatch(client, i);
        latencies.push(performance.now() - t);
      }
    }),
  );
  const seconds = (performance.now() - started) / 1000;
  return { ...summarize(latencies), rps: total / seconds };
}

const out = { rest: {}, grpc: {} };
const answers = {};

// ---------------------------------------------------------------------------
heading('Correctness first: do both transports give the same answer?');
for (const transport of ['rest', 'grpc']) {
  const svc = await startServices(transport, { work: WORK_MS });
  const client = makeClient(transport, svc.endpoints);
  answers[transport] = await dispatch(client, 7);
  client.close();
  await svc.stop();
}
console.log('  REST :', JSON.stringify(answers.rest));
console.log('  gRPC :', JSON.stringify(answers.grpc));
console.log(
  JSON.stringify(answers.rest) === JSON.stringify(answers.grpc)
    ? '  Identical. Same logic, different transport.'
    : '  MISMATCH. Something is wrong.',
);

// ---------------------------------------------------------------------------
heading(`Latency & throughput (${TOTAL} ride requests, ${WORK_MS} ms of work per service)`);
for (const transport of ['rest', 'grpc']) {
  const svc = await startServices(transport, { work: WORK_MS });
  const client = makeClient(transport, svc.endpoints);
  await load(client, 10, 200); // warm up JIT + connections
  for (const c of CONCURRENCIES) out[transport][c] = await load(client, c, TOTAL);
  client.close();
  await svc.stop();
}

for (const c of CONCURRENCIES) {
  console.log(`\n  ${c} concurrent ride request${c > 1 ? 's' : ''} in flight:`);
  table(
    ['rest', 'grpc'].map((t) => {
      const s = out[t][c];
      return [t === 'rest' ? 'REST + JSON' : 'gRPC + protobuf', fmtMs(s.p50), fmtMs(s.p95), fmtMs(s.p99), `${s.rps.toFixed(0)} req/s`];
    }),
    ['transport', 'p50', 'p95', 'p99', 'throughput'],
  );
}

// ---------------------------------------------------------------------------
heading('What really crossed the wire? (counting proxy in front of every service)');
const CONC_WIRE = 50;
const N_WIRE = 300;
const wire = {};
for (const transport of ['rest', 'grpc']) {
  const svc = await startServices(transport, { work: WORK_MS, proxy: true });
  const client = makeClient(transport, svc.endpoints);
  await load(client, 10, 50); // warm
  svc.resetWire();
  await load(client, CONC_WIRE, N_WIRE);
  wire[transport] = svc.wire();
  client.close();
  await svc.stop();
}
table(
  ['rest', 'grpc'].map((t) => [
    t === 'rest' ? 'REST + JSON' : 'gRPC + protobuf',
    fmtBytes(Math.round(wire[t].bytes / N_WIRE)),
    String(wire[t].connections),
  ]),
  ['transport', 'bytes / ride request', `TCP connections opened (${CONC_WIRE} concurrent)`],
);
console.log(`
  Bytes include headers and framing, in both directions, across all 3 services.
  Connections: HTTP/1.1 needs one socket per in-flight request, so the client
  opens many. HTTP/2 multiplexes every call over ONE connection per service.`);
