// LESSON 1: what does ONE call cost?
//
// We run the exact same Pricing.Quote logic three ways and time each:
//   1. as a plain function call (the baseline: no network at all)
//   2. over REST (JSON on HTTP/1.1)
//   3. over gRPC (protobuf on HTTP/2)
//
// The work itself is free (workMs: 0), so what we measure is pure overhead.
import { createHandlers } from '../../src/handlers.mjs';
import { createClient } from '../../src/clients/index.mjs';
import { startServices } from '../../src/harness/cluster.mjs';
import { makeRideRequest } from '../../src/seed.mjs';
import { heading, formatMicros, latencyRecorder, timed } from '../../src/harness/report.mjs';

const WARMUP_CALLS = 300; // let the JIT and the connections warm up; not measured
const MEASURED_CALLS = 3000;
const ride = makeRideRequest(1);

// Calls `fn` one at a time (sequentially) and summarizes how long each took.
async function measure(fn) {
  for (let i = 0; i < WARMUP_CALLS; i++) await fn();
  const latency = latencyRecorder();
  for (let i = 0; i < MEASURED_CALLS; i++) await timed(latency, fn);
  return latency.summary();
}

heading('Lesson 1: what does one call cost?');

// 1. Baseline: call the handler directly, in the same process.
const handlers = createHandlers({ workMs: 0 });
const results = { 'function call (same process)': await measure(() => handlers.Pricing.Quote(ride)) };

// 2 and 3. Start the Pricing service as its own process, once per transport.
const labels = { rest: 'REST + JSON', grpc: 'gRPC + protobuf' };
for (const transport of ['rest', 'grpc']) {
  const services = await startServices(transport, { only: ['Pricing'], workMs: 0 });
  const client = createClient(transport, services.endpoints);

  results[labels[transport]] = await measure(() => client.quote(ride));

  client.close();
  services.stop();
}

console.table(
  Object.fromEntries(
    Object.entries(results).map(([label, s]) => [
      label,
      { mean: formatMicros(s.mean), p50: formatMicros(s.p50), p99: formatMicros(s.p99) },
    ]),
  ),
);
