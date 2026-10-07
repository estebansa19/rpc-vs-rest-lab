// LESSON 4: a realistic request path, under load.
//
// A "Dispatch" step handles a ride request by calling three services, each running
// as its own OS process:
//
//                    +--> Drivers.Nearby  (50 drivers around you) --+
//   ride request --> |                                              +--> pick nearest --> Eta.Estimate
//                    +--> Pricing.Quote   (price and surge) --------+
//
// Two calls in parallel, then one that depends on their result: the shape of most
// real request paths. We run it over REST and over gRPC and compare latency,
// throughput, bytes on the wire, and how many TCP connections each needs.
import pMap from 'p-map';
import { getDistance } from 'geolib';
import { createClient } from '../../src/clients/index.mjs';
import { startServices } from '../../src/harness/cluster.mjs';
import { makeRideRequest } from '../../src/seed.mjs';
import { heading, formatMs, formatBytes, latencyRecorder, timed } from '../../src/harness/report.mjs';

const WORK_MS = 3; // each service pretends to do ~3 ms of real work (DB lookup, cache miss...)
const REQUESTS = 1500;
const CONCURRENCY_LEVELS = [1, 25, 100]; // ride requests in flight at the same time
const TRANSPORTS = { rest: 'REST + JSON', grpc: 'gRPC + protobuf' };

// The application code. It only uses the client's methods, so it is identical for
// REST and gRPC: nothing here knows which transport is underneath.
async function handleRideRequest(client, index) {
  const ride = makeRideRequest(index);

  const [nearby, quote] = await Promise.all([
    client.nearby({ origin: ride.origin, limit: 50 }),
    client.quote(ride),
  ]);

  const distanceToRider = (driver) => getDistance(driver.location, ride.origin);
  const nearest = nearby.drivers
    .filter((driver) => driver.available)
    .reduce((best, driver) => (distanceToRider(driver) < distanceToRider(best) ? driver : best));

  const eta = await client.eta({ from: nearest.location, to: ride.origin });
  return { driver: nearest.id, price_cents: quote.amount_cents, surge: quote.surge, eta_seconds: eta.seconds };
}

// Sends `total` ride requests, keeping `concurrency` of them in flight at once.
async function runLoad(client, concurrency, total) {
  const latency = latencyRecorder();
  const started = performance.now();
  await pMap(
    Array.from({ length: total }, (_, i) => i),
    (index) => timed(latency, () => handleRideRequest(client, index)),
    { concurrency },
  );
  const seconds = (performance.now() - started) / 1000;
  return { ...latency.summary(), throughput: total / seconds };
}

// ---------------------------------------------------------------------------
heading('Lesson 4a: both transports must give the same answer');

const answers = {};
for (const transport of Object.keys(TRANSPORTS)) {
  const services = await startServices(transport, { workMs: WORK_MS });
  const client = createClient(transport, services.endpoints);
  answers[transport] = await handleRideRequest(client, 7);
  client.close();
  services.stop();
}
console.log('REST:', answers.rest);
console.log('gRPC:', answers.grpc);
if (JSON.stringify(answers.rest) !== JSON.stringify(answers.grpc)) throw new Error('transports disagree');
console.log('Identical: same logic, different transport.');

// ---------------------------------------------------------------------------
heading(`Lesson 4b: latency and throughput (${REQUESTS} ride requests each)`);

const results = { rest: {}, grpc: {} };
for (const transport of Object.keys(TRANSPORTS)) {
  const services = await startServices(transport, { workMs: WORK_MS });
  const client = createClient(transport, services.endpoints);

  await runLoad(client, 10, 200); // warm-up, not reported
  for (const concurrency of CONCURRENCY_LEVELS) {
    results[transport][concurrency] = await runLoad(client, concurrency, REQUESTS);
  }

  client.close();
  services.stop();
}

for (const concurrency of CONCURRENCY_LEVELS) {
  console.log(`${concurrency} ride request(s) in flight at once:`);
  console.table(
    Object.fromEntries(
      Object.entries(TRANSPORTS).map(([transport, label]) => {
        const r = results[transport][concurrency];
        return [label, { p50: formatMs(r.p50), p95: formatMs(r.p95), p99: formatMs(r.p99), 'req/s': Math.round(r.throughput) }];
      }),
    ),
  );
}

// ---------------------------------------------------------------------------
heading('Lesson 4c: what really crossed the wire');

// Same run again, but with a counting proxy in front of every service.
const WIRE_CONCURRENCY = 50;
const WIRE_REQUESTS = 300;
const wire = {};
for (const transport of Object.keys(TRANSPORTS)) {
  const services = await startServices(transport, { workMs: WORK_MS, proxy: true });
  const client = createClient(transport, services.endpoints);

  await runLoad(client, 10, 50); // warm-up: this is when connections get opened
  services.resetWireBytes();
  await runLoad(client, WIRE_CONCURRENCY, WIRE_REQUESTS);

  wire[transport] = services.wire();
  client.close();
  services.stop();
}

console.table(
  Object.fromEntries(
    Object.entries(TRANSPORTS).map(([transport, label]) => [
      label,
      {
        'bytes per ride request': formatBytes(Math.round(wire[transport].bytes / WIRE_REQUESTS)),
        'TCP connections opened': wire[transport].connections,
      },
    ]),
  ),
);
console.log('Bytes include headers and framing, both directions, across all 3 services.');
