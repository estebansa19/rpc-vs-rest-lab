export function percentile(sorted, p) {
  if (!sorted.length) return NaN;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

export function summarize(samplesMs) {
  const s = [...samplesMs].sort((a, b) => a - b);
  const mean = s.reduce((x, y) => x + y, 0) / s.length;
  return { n: s.length, mean, p50: percentile(s, 50), p95: percentile(s, 95), p99: percentile(s, 99) };
}

export const fmtMs = (v) => `${v.toFixed(2)} ms`;
export const fmtUs = (ms) => `${(ms * 1000).toFixed(0)} µs`;
export const fmtBytes = (n) => (n >= 1024 ? `${(n / 1024).toFixed(1)} KiB` : `${n} B`);

// Tiny aligned-table printer so the output reads like a lab report.
export function table(rows, header) {
  const all = header ? [header, ...rows] : rows;
  const widths = all[0].map((_, c) => Math.max(...all.map((r) => String(r[c]).length)));
  const line = (r) => '  ' + r.map((v, c) => String(v).padEnd(widths[c])).join('   ');
  if (header) {
    console.log(line(header));
    console.log('  ' + widths.map((w) => '-'.repeat(w)).join('   '));
    rows.forEach((r) => console.log(line(r)));
  } else {
    rows.forEach((r) => console.log(line(r)));
  }
}

export const heading = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 70 - t.length))}`);
