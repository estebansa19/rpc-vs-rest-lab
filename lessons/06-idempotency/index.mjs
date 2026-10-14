// LESSON 6: idempotency keys, or how to retry a POST without charging twice.
//
// A payment server records charges in memory. We break it in the two ways real
// systems break, and count the charges each time:
//   - a LOST REPLY: the server does the work, then the connection dies, so the
//     client can't tell whether it worked and retries;
//   - a RACE: two requests with the same key arrive at the same moment.
// The fix is an Idempotency-Key header: one key per logical operation, reused by
// every retry, and a server that replays the stored result instead of redoing it.
import Fastify from 'fastify';
import { setTimeout as sleep } from 'node:timers/promises';
import { heading } from '../../src/harness/report.mjs';

const WORK_MS = 50; // how long a charge takes, e.g. asking the card network

// mode: 'none'        ignore idempotency keys entirely
//       'naive'       store the key AFTER the slow work (leaves a gap for a race)
//       'claim-first' store the key BEFORE any await (no gap)
async function startPaymentServer({ mode, dropFirstReply = false }) {
  const charges = []; // the "database": counting it is the experiment
  const keys = new Map(); // idempotency key -> { body, result } (result may be a pending promise)
  let dropNextReply = dropFirstReply;

  async function doCharge(body) {
    await sleep(WORK_MS);
    const charge = { id: `ch_${charges.length + 1}`, amount: body.amount };
    charges.push(charge);
    return { id: charge.id };
  }

  const app = Fastify();
  app.post('/charge', async (request, reply) => {
    const key = mode === 'none' ? undefined : request.headers['idempotency-key'];
    const body = JSON.stringify(request.body);

    const seen = key && keys.get(key);
    if (seen) {
      // Same key, different request: a client bug. Replaying would report the
      // wrong charge and charging would break the key's promise, so refuse.
      if (seen.body !== body) return reply.code(422).send({ error: 'key reused with a different body' });
      // Same operation again: replay. If the first request is still running,
      // this waits for its result instead of charging a second time.
      return seen.result;
    }

    let result;
    if (mode === 'claim-first') {
      // Node only switches to another request at an await. Claiming the key
      // before the first await means a duplicate always finds it.
      result = doCharge(request.body);
      if (key) keys.set(key, { body, result });
      result = await result;
    } else {
      result = await doCharge(request.body);
      // Too late: another request with this key may have passed the check above
      // while we were waiting.
      if (key) keys.set(key, { body, result });
    }

    if (dropNextReply) {
      // The work is done and recorded, but the reply never leaves.
      dropNextReply = false;
      reply.hijack();
      request.raw.socket.destroy();
      return;
    }
    return result;
  });

  await app.listen({ port: 0, host: '127.0.0.1' });
  return { url: `http://127.0.0.1:${app.server.address().port}/charge`, charges, close: () => app.close() };
}

// One HTTP attempt. Resolves with a short description of the reply; rejects if
// no reply arrives at all.
async function send(url, body, idempotencyKey) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  return `${response.status} ${json.id ?? json.error}`;
}

// ONE key per logical operation, created before the first attempt and reused by
// every retry. On "no reply" the client can't know if the charge happened, so it
// retries and relies on the key to make that safe.
async function chargeWithRetries(url, body) {
  const key = crypto.randomUUID();
  const outcomes = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      outcomes.push(await send(url, body, key));
      return outcomes;
    } catch {
      outcomes.push('no reply');
    }
  }
  return outcomes;
}

async function bothAtOnce(url) {
  const key = crypto.randomUUID();
  return Promise.all([send(url, { amount: 1000 }, key), send(url, { amount: 1000 }, key)]);
}

async function sameKeyDifferentBody(url) {
  const key = crypto.randomUUID();
  return [await send(url, { amount: 1000 }, key), await send(url, { amount: 5000 }, key)];
}

async function run(serverOptions, client) {
  const server = await startPaymentServer(serverOptions);
  const replies = await client(server.url);
  await server.close();
  return { 'replies the client saw': replies.join(', '), 'charges made': server.charges.length };
}

heading('Lesson 6: idempotency (every scenario is ONE logical charge)');

const retry = (url) => chargeWithRetries(url, { amount: 1000 });

console.table({
  'lost reply + retry, no key': await run({ mode: 'none', dropFirstReply: true }, retry),
  'lost reply + retry, with key': await run({ mode: 'claim-first', dropFirstReply: true }, retry),
  'two at once, key stored after work': await run({ mode: 'naive' }, bothAtOnce),
  'two at once, key claimed first': await run({ mode: 'claim-first' }, bothAtOnce),
  'same key, different amount': await run({ mode: 'claim-first' }, sameKeyDifferentBody),
});
