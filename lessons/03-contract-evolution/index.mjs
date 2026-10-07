// LESSON 3: what happens when the contract changes?
//
// Services get upgraded independently, so an OLD client will talk to a NEW
// server. We simulate that without any network: the new server encodes a
// response, and an old client (built from the old contract) decodes it.
//
// The change in version 2 of the Pricing service:
//   - renames `currency` to `currency_code`
//   - adds a new field `surge_reason`
import protobuf from 'protobufjs';
import { heading } from '../../src/harness/report.mjs';

// Two versions of the same message. NOTE the field numbers: `currency` and
// `currency_code` are both field 2. That number is the field's real identity.
const parse = (proto) => protobuf.parse(proto, { keepCase: true }).root.lookupType('Quote');
const QuoteV1 = parse(`syntax = "proto3";
  message Quote { int64 amount_cents = 1; string currency = 2; double surge = 3; }`);
const QuoteV2 = parse(`syntax = "proto3";
  message Quote { int64 amount_cents = 1; string currency_code = 2; double surge = 3; string surge_reason = 4; }`);

// What the NEW (v2) server sends, as the same data in both formats.
const v2Response = { amount_cents: 1450, currency_code: 'USD', surge: 1.4, surge_reason: 'concert ending' };

heading('Lesson 3a: old client, new server');

// gRPC/protobuf: the v2 server encodes bytes; the v1 client decodes them.
const bytes = QuoteV2.encode(QuoteV2.fromObject(v2Response)).finish();
const seenByOldGrpcClient = QuoteV1.toObject(QuoteV1.decode(bytes), { defaults: true, longs: Number });

// REST/JSON: the v2 server sends JSON; the old client reads the key it knows, `currency`.
const seenByOldRestClient = JSON.parse(JSON.stringify(v2Response));

console.log('Old gRPC client sees:', seenByOldGrpcClient);
console.log('  -> currency is "USD". The wire carries field number 2, not the name, so the');
console.log('     rename was harmless, and the unknown new field was simply ignored.\n');
console.log(`Old REST client reads quote.currency: ${seenByOldRestClient.currency}`);
console.log('  -> undefined. The rename broke it silently. Nothing failed at the boundary;');
console.log('     you find out later, e.g. "undefined 14.50" on a receipt.');

heading('Lesson 3b: the catch (protobuf is forgiving too)');

// The v2 server forgets to send amount_cents at all.
const forgotten = QuoteV2.encode(QuoteV2.fromObject({ currency_code: 'USD' })).finish();
const { amount_cents } = QuoteV1.toObject(QuoteV1.decode(forgotten), { defaults: true, longs: Number });

console.log(`If the server stops sending amount_cents, the old client reads: ${amount_cents}`);
console.log('  -> proto3 fills in the default (0). Not an error, so nothing alerts you.');
console.log('Protobuf gives you tooling to catch this (reserved fields, `buf breaking` in CI),');
console.log('but you have to actually use it. It is discipline, not magic.');
