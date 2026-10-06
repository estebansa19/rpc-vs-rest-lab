// PART 3: live driver location. The case REST was never designed for.
//
// The server produces a new location 10x per second (every 100 ms).
//   gRPC : open ONE server-streaming call; the server PUSHES each update.
//   REST : the client has to ASK ("polling"), and has to pick how often.
//
// We run each for a few seconds and count what the client actually got.
import { startServices } from './lib/cluster.mjs';
import { makeClient } from './lib/clients.mjs';
import { fmtBytes, table, heading } from './lib/stats.mjs';

const SECONDS = 4;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// What would a map on screen experience? Every 10 ms, ask "how old is the newest
// location I've received?" The average of that is the real staleness.
function stalenessSampler() {
  let latestTs = null;
  const samples = [];
  const timer = setInterval(() => latestTs && samples.push(Date.now() - latestTs), 10);
  return {
    saw: (loc) => (latestTs = loc.ts),
    reset: () => (samples.length = 0),
    stop: () => {
      clearInterval(timer);
      return samples.reduce((a, b) => a + b, 0) / samples.length;
    },
  };
}

// ---------------------------------------------------------------- gRPC stream
async function runStream() {
  const svc = await startServices('grpc', { only: ['Drivers'], proxy: true });
  const client = makeClient('grpc', svc.endpoints);
  const seen = new Set();
  const view = stalenessSampler();
  const call = client.track({ driver_id: 'drv_1' }, (loc) => {
    seen.add(loc.seq);
    view.saw(loc);
  });
  await sleep(300); // let the connection settle, then measure a clean window
  svc.resetWire();
  seen.clear();
  view.reset();
  await sleep(SECONDS * 1000);
  const result = { requests: 1, updates: seen.size, staleMs: view.stop(), wire: svc.wire() };
  call.cancel();
  client.close();
  await svc.stop();
  return result;
}

// ---------------------------------------------------------------- REST polling
async function runPolling(intervalMs) {
  const svc = await startServices('rest', { only: ['Drivers'], proxy: true });
  const client = makeClient('rest', svc.endpoints);
  await client.latestLocation(); // warm connection
  svc.resetWire();
  const seen = new Set();
  const view = stalenessSampler();
  let requests = 0;
  const end = Date.now() + SECONDS * 1000;
  while (Date.now() < end) {
    const loc = await client.latestLocation();
    requests++;
    seen.add(loc.seq);
    view.saw(loc);
    await sleep(intervalMs);
  }
  const result = { requests, updates: seen.size, staleMs: view.stop(), wire: svc.wire() };
  client.close();
  await svc.stop();
  return result;
}

heading(`Live driver location: server emits ~${SECONDS * 10} updates over ${SECONDS} s`);
const runs = [
  ['gRPC stream (1 call, server pushes)', await runStream()],
  ['REST poll every 100 ms', await runPolling(100)],
  ['REST poll every 500 ms', await runPolling(500)],
];

table(
  runs.map(([label, r]) => [
    label,
    String(r.requests),
    `${r.updates} / ~${SECONDS * 10}`,
    `${r.staleMs.toFixed(0)} ms`,
    fmtBytes(r.wire.bytes),
  ]),
  ['approach', 'requests made', 'updates received', 'avg staleness on screen', 'bytes on wire'],
);

console.log(`
  Reading it:
  - Updates only exist every 100 ms, so even a perfect push leaves the screen
    ~50 ms stale on average. That's the FLOOR; the stream sits right on it.
  - Polling at the update rate (100 ms) also catches every update, but pays a
    full HTTP request per update (headers + a round trip): ~6x the bytes, and
    the screen is a bit further behind the floor.
  - Polling slowly (500 ms) is cheap, but you see only a fraction of the updates
    and the screen lags the floor by ~250 ms. You're choosing between cost and
    freshness; the stream doesn't make you choose.
  Push vs pull is the real architectural difference, and it's the case where
  streaming RPC earns its keep (live maps, ETAs, dispatch).`);
