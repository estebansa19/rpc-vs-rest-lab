// LESSON 2: what actually goes over the wire?
//
// The same data, encoded as JSON and as protobuf. We look at the bytes, then
// at how size changes for a realistic response, with and without gzip.
import zlib from 'node:zlib';
import protobuf from 'protobufjs';
import { createHandlers } from '../../src/handlers.mjs';
import { PROTO_PATH } from '../../src/proto.mjs';
import { SF, makeDrivers, makeRideRequest } from '../../src/seed.mjs';
import { heading, formatBytes } from '../../src/harness/report.mjs';

// protobufjs lets us encode a message ourselves, so we can see the raw bytes
// that gRPC would send. keepCase keeps snake_case field names, like the lab's JSON.
const root = new protobuf.Root().loadSync(PROTO_PATH, { keepCase: true });
function toProtobuf(messageName, object) {
  const Message = root.lookupType(`rides.${messageName}`);
  return Buffer.from(Message.encode(Message.fromObject(object)).finish());
}
const toJson = (object) => Buffer.from(JSON.stringify(object));
const gzipSize = (buffer) => zlib.gzipSync(buffer).length;

heading('Lesson 2a: one small message');

const quote = await createHandlers({ workMs: 0 }).Pricing.Quote(makeRideRequest(1));
const json = toJson(quote);
const protobufBytes = toProtobuf('QuoteResponse', quote);

console.log(`The data:   ${JSON.stringify(quote)}\n`);
console.log(`JSON     (${json.length} bytes):  ${json}`);
console.log(`protobuf (${protobufBytes.length} bytes):  ${protobufBytes.toString('hex').replace(/(..)/g, '$1 ').trim()}\n`);
console.log('Reading the protobuf bytes:');
console.log('  08 xx..       field 1 (amount_cents)  a "varint" integer');
console.log('  12 03 55 53 44  field 2 (currency)      length 3, then "USD"');
console.log('  19 xx x8      field 3 (surge)         an 8-byte double');
console.log('No field NAMES anywhere, only field NUMBERS. Both sides need the .proto to decode it.');

heading('Lesson 2b: a realistic message (50 nearby drivers)');

const nearby = { drivers: makeDrivers(50, SF) };
const nearbyJson = toJson(nearby);
const nearbyProtobuf = toProtobuf('NearbyResponse', nearby);

const sizeRow = (bytes, compressed) => ({
  size: formatBytes(bytes.length),
  'vs JSON': `${((bytes.length / nearbyJson.length) * 100).toFixed(0)}%`,
  'size with gzip': formatBytes(compressed),
});
console.table({
  JSON: sizeRow(nearbyJson, gzipSize(nearbyJson)),
  protobuf: sizeRow(nearbyProtobuf, gzipSize(nearbyProtobuf)),
});
