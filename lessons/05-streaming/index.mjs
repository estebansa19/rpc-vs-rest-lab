// LESSON 5: live driver location, the case REST wasn't designed for.
//
// The server produces a new location every 100 ms (10 per second).
//   gRPC : open ONE server-streaming call; the server PUSHES every update.
//   REST : the client must ASK ("polling") and has to choose how often.
//
// For each approach we run a few seconds and record what the client really got.
import { createClient } from '../../src/clients/index.mjs';
import { startServices } from '../../src/harness/cluster.mjs';
import { TICK_MS } from '../../src/location-feed.mjs';
import { heading, formatBytes } from '../../src/harness/report.mjs';
import { setTimeout as sleep } from 'node:timers/promises';

const RUN_SECONDS = 4;
const EXPECTED_UPDATES = (RUN_SECONDS * 1000) / TICK_MS;

// Imagine a map on the rider's screen showing the newest location we've received.
// Every 10 ms we ask: "how old is that location right now?". The average is how
// stale the map is. Note the FLOOR: locations only exist every TICK_MS, so even
// a perfect push is about TICK_MS / 2 stale on average.
function watchStaleness() {
  let newestTimestamp;
  const samples = [];
  const timer = setInterval(() => newestTimestamp && samples.push(Date.now() - newestTimestamp), 10);
  return {
    received: (location) => (newestTimestamp = location.ts),
    averageMs() {
      clearInterval(timer);
      return samples.reduce((a, b) => a + b, 0) / samples.length;
    },
  };
}

async function runGrpcStream() {
  const services = await startServices('grpc', { only: ['Drivers'], proxy: true });
  const client = createClient('grpc', services.endpoints);

  const seen = new Set();
  const staleness = watchStaleness();
  const call = client.track({ driver_id: 'drv_1' }, (location) => {
    seen.add(location.seq);
    staleness.received(location);
  });

  await sleep(300); // let the connection settle, then measure a clean window
  services.resetWireBytes();
  seen.clear();
  await sleep(RUN_SECONDS * 1000);

  const result = { requests: 1, updates: seen.size, staleMs: staleness.averageMs(), bytes: services.wire().bytes };
  call.cancel();
  client.close();
  services.stop();
  return result;
}

async function runRestPolling(intervalMs) {
  const services = await startServices('rest', { only: ['Drivers'], proxy: true });
  const client = createClient('rest', services.endpoints);

  await client.latestLocation(); // open the connection first
  services.resetWireBytes();

  const seen = new Set();
  const staleness = watchStaleness();
  let requests = 0;
  const stopAt = Date.now() + RUN_SECONDS * 1000;
  while (Date.now() < stopAt) {
    const location = await client.latestLocation();
    requests++;
    seen.add(location.seq);
    staleness.received(location);
    await sleep(intervalMs);
  }

  const result = { requests, updates: seen.size, staleMs: staleness.averageMs(), bytes: services.wire().bytes };
  client.close();
  services.stop();
  return result;
}

heading(`Lesson 5: live location (the server emits ~${EXPECTED_UPDATES} updates over ${RUN_SECONDS} s)`);

const runs = {
  'gRPC stream (1 call, server pushes)': await runGrpcStream(),
  'REST poll every 100 ms': await runRestPolling(100),
  'REST poll every 500 ms': await runRestPolling(500),
};

console.table(
  Object.fromEntries(
    Object.entries(runs).map(([label, r]) => [
      label,
      {
        'requests made': r.requests,
        'updates received': `${r.updates} / ~${EXPECTED_UPDATES}`,
        'avg map staleness': `${r.staleMs.toFixed(0)} ms`,
        'bytes on wire': formatBytes(r.bytes),
      },
    ]),
  ),
);
