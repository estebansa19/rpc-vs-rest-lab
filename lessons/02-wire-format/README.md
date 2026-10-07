# Lesson 2: what actually goes over the wire?

```bash
npm run lesson2
```

## The idea

JSON is text and repeats every field name in every message. Protobuf is binary and sends only a field *number* plus the value; the field names live in the `.proto` file, which both sides share.

## What you'll see (sample run)

One small message:

```
JSON     (47 bytes):  {"amount_cents":624,"currency":"USD","surge":1}
protobuf (17 bytes):  08 f0 04 12 03 55 53 44 19 00 00 00 00 00 00 f0 3f
```

Reading the protobuf: `08` = field 1 as a varint; `12 03 55 53 44` = field 2, length 3, `"USD"`; `19` + 8 bytes = field 3, a double. No names anywhere.

Fifty nearby drivers:

| encoding | size | vs JSON | size with gzip |
|---|---|---|---|
| JSON | ~8.8 KiB | 100% | ~2.7 KiB |
| protobuf | ~4.0 KiB | ~46% | ~2.6 KiB |

## What to notice

- Protobuf is **about half the size** of JSON before compression.
- With gzip, the two are nearly the same. JSON compresses well precisely because its repeated field names are so predictable. So "protobuf is smaller" is true but weaker than it sounds if your HTTP layer compresses.
- The real cost of the compact format is that the bytes are **meaningless without the `.proto`**. That dependency is also the source of RPC's main benefit: a contract. Lesson 3 shows it.

## Code to read

- `index.mjs`: encodes by hand with `protobufjs` so you can see the exact bytes gRPC would send.
- `../../proto/rides.proto`: the contract those bytes are decoded against.
