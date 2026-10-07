// Small helpers so every lesson prints results the same way.
import { createHistogram } from 'node:perf_hooks';

export const heading = (title) => console.log(`\n=== ${title} ===\n`);

export const formatMs = (ms) => `${ms.toFixed(2)} ms`;
export const formatMicros = (ms) => `${Math.round(ms * 1000)} µs`;
export const formatBytes = (n) => (n >= 1024 ? `${(n / 1024).toFixed(1)} KiB` : `${n} B`);

// Records latencies and reports percentiles. Uses Node's built-in histogram
// (it stores integers, so we record microseconds). Reported values are in ms.
export function latencyRecorder() {
  const histogram = createHistogram();
  return {
    record: (ms) => histogram.record(Math.max(1, Math.round(ms * 1000))),
    summary: () => ({
      mean: histogram.mean / 1000,
      p50: histogram.percentile(50) / 1000,
      p95: histogram.percentile(95) / 1000,
      p99: histogram.percentile(99) / 1000,
    }),
  };
}

// Times `fn` and records the duration.
export async function timed(recorder, fn) {
  const start = performance.now();
  const result = await fn();
  recorder.record(performance.now() - start);
  return result;
}
