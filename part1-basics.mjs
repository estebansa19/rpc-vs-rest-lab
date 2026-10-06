// PART 1: the basics. Same operation, three ways. No fan-out, no load yet.
//   1. What does one call cost? (local function vs REST vs gRPC)
//   2. What actually goes over the wire? (JSON vs protobuf)
//   3. What happens when the contract changes?
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import protobuf from 'protobufjs';
import { startServices } from './lib/cluster.mjs';
import { makeClient } from './lib/clients.mjs';
import { makeDrivers, makeRideRequest, SF } from './lib/data.mjs';
import { summarize, fmtUs, fmtBytes, table, heading } from './lib/stats.mjs';

process.env.WORK_MS = '0'; // part 1 measures pure overhead: the "work" is free
const { handlers } = await import('./lib/handlers.mjs');
const PROTO = path.join(path.dirname(fileURLToPath(import.meta.url)), 'proto/rides.proto');

// ---------------------------------------------------------------------------
heading('1. What does ONE call cost? (the work itself is free here)');
console.log('  Same Pricing.Quote logic. Only the way we reach it changes.\n');

const req = makeRideRequest(1);
const N = 3000;
const WARMUP = 300;

async function timeIt(fn) {
  for (let i = 0; i < WARMUP; i++) await fn();
  const samples = [];
  for (let i = 0; i < N; i++) {
    const t = performance.now();
    await fn();
    samples.push(performance.now() - t);
  }
  return summarize(samples);
}

const local = await timeIt(() => handlers.Pricing.Quote(req));
const results = { 'in-process function call': local };

for (const transport of ['rest', 'grpc']) {
  const svc = await startServices(transport, { only: ['Pricing'], work: 0 });
  const client = makeClient(transport, svc.endpoints);
  results[transport === 'rest' ? 'REST + JSON (HTTP/1.1)' : 'gRPC + protobuf (HTTP/2)'] = await timeIt(() =>
    client.quote(req),
  );
  client.close();
  await svc.stop();
}

table(
  Object.entries(results).map(([k, s]) => [k, fmtUs(s.mean), fmtUs(s.p50), fmtUs(s.p99)]),
  ['how we call it', 'mean', 'p50', 'p99'],
);
console.log(`
  Reading it: the jump from "function call" to ANY network call is the big one.
  That cost is paid on every hop in a call graph, which is why chatty
  microservices hurt and why shaving per-hop overhead matters at scale.`);

// ---------------------------------------------------------------------------
heading('2. What actually goes over the wire?');

const root = new protobuf.Root();
root.loadSync(PROTO, { keepCase: true });
const encode = (typeName, obj) => {
  const T = root.lookupType(`rides.${typeName}`);
  return Buffer.from(T.encode(T.fromObject(obj)).finish());
};

// 2a. one tiny message
const quote = await handlers.Pricing.Quote(req);
const quoteJson = Buffer.from(JSON.stringify(quote));
const quotePb = encode('QuoteResponse', quote);

console.log('  A Quote response:', JSON.stringify(quote));
console.log(`\n  JSON     (${quoteJson.length} B): ${quoteJson.toString()}`);
console.log(`  protobuf (${quotePb.length} B): ${quotePb.toString('hex').replace(/(..)/g, '$1 ').trim()}`);
console.log(`
  Decode the protobuf by hand:
    08 ..        -> field 1 (amount_cents), varint
    12 03 55 53 44 -> field 2 (currency), 3 bytes: "USD"
    19 ..        -> field 3 (surge), 8-byte double
  There are NO field names in the bytes. Just field numbers + values.
  Both sides need the .proto to make sense of it. That's the contract.`);

// 2b. a realistic, bigger message: 50 nearby drivers
const nearby = { drivers: makeDrivers(50, SF) };
const nJson = Buffer.from(JSON.stringify(nearby));
const nPb = encode('NearbyResponse', nearby);
const gz = (b) => zlib.gzipSync(b).length;

console.log('\n  Nearby(50 drivers) response:\n');
table(
  [
    ['JSON', fmtBytes(nJson.length), '1.00x'],
    ['JSON + gzip', fmtBytes(gz(nJson)), `${(gz(nJson) / nJson.length).toFixed(2)}x`],
    ['protobuf', fmtBytes(nPb.length), `${(nPb.length / nJson.length).toFixed(2)}x`],
    ['protobuf + gzip', fmtBytes(gz(nPb)), `${(gz(nPb) / nJson.length).toFixed(2)}x`],
  ],
  ['encoding', 'size', 'vs JSON'],
);
console.log(`
  Honest takeaway: protobuf is smaller than plain JSON, but gzip'd JSON gets
  close. Size alone is NOT the whole story. The bigger wins are the contract,
  the codegen, and streaming (section 3 below, and part 3).`);

// ---------------------------------------------------------------------------
heading('3. What happens when the contract changes?');

// v2 of the Pricing server renames `currency` -> `currency_code` and adds a field.
const v1 = protobuf.parse(
  `syntax="proto3"; message Quote { int64 amount_cents=1; string currency=2; double surge=3; }`,
  { keepCase: true },
).root.lookupType('Quote');
const v2 = protobuf.parse(
  `syntax="proto3"; message Quote { int64 amount_cents=1; string currency_code=2; double surge=3; string surge_reason=4; }`,
  { keepCase: true },
).root.lookupType('Quote');

const v2Server = { amount_cents: 1450, currency_code: 'USD', surge: 1.4, surge_reason: 'concert ending' };

// gRPC: the server (v2) sends bytes; an OLD client (v1 proto) decodes them.
const wireBytes = v2.encode(v2.fromObject(v2Server)).finish();
const oldClientSees = v1.toObject(v1.decode(wireBytes), { defaults: true, longs: Number });

// REST: the server (v2) sends JSON; the same OLD client code reads `.currency`.
const restBody = JSON.parse(JSON.stringify(v2Server));

console.log('  Server upgrades: renames currency -> currency_code, adds surge_reason.\n');
console.log('  OLD gRPC client reads:', JSON.stringify(oldClientSees));
console.log('    -> currency still "USD": the wire uses field NUMBER 2, so the rename was safe.');
console.log('       The new field was ignored. Old and new versions can run side by side.\n');
console.log(`  OLD REST client reads quote.currency: ${restBody.currency}`);
console.log('    -> undefined. The rename silently broke it. No error at the boundary,');
console.log('       you find out later when "undefined USD" shows up on a receipt.');

// The honest caveat: proto3 is forgiving too.
const dropped = v2.encode(v2.fromObject({ currency_code: 'USD' })).finish();
console.log(
  `\n  Caveat: if a server stops sending amount_cents, an old gRPC client reads\n  amount_cents = ${
    v1.toObject(v1.decode(dropped), { defaults: true, longs: Number }).amount_cents
  } (the proto3 default), not an error. Protobuf gives you the tooling to\n  catch breaking changes (buf breaking, reserved fields, shared codegen),\n  but you still have to use it. It's discipline, not magic.`);
