# Lesson 1: what does one call cost?

```bash
npm run lesson1
```

## The idea

Calling a function in the same process is almost free. Calling a function on *another service* means: serialize the arguments, push bytes through a socket, wake up another process, run the function, serialize the answer, send it back, parse it. Microservices turn function calls into this.

This lesson times the same `Pricing.Quote` logic three ways, with the work itself made free (`workMs: 0`) so only the overhead shows.

## What you'll see (sample run)

| how we call it | mean | p50 | p99 |
|---|---|---|---|
| function call (same process) | ~1 µs | ~1 µs | ~4 µs |
| REST + JSON | ~90 µs | ~78 µs | ~214 µs |
| gRPC + protobuf | ~104 µs | ~94 µs | ~204 µs |

## What to notice

- The big jump is from **function call to any network call**: roughly 100x. REST vs gRPC is a small difference next to it.
- A request that touches 10 services pays this 10 times. That is why deep call graphs and chatty services hurt, and why per-hop overhead matters at scale.
- On a single sequential call, gRPC is **not** faster here. Its advantages (lesson 2 onward) show up in bytes, connections, contracts and streaming, not in this number.

## Code to read

- `index.mjs`: the experiment (~50 lines).
- `../../src/handlers.mjs`: the one function all three variants call.
