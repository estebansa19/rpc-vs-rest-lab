# Lesson 4: a realistic request path, under load

```bash
npm run lesson4      # takes about a minute
```

## The idea

Real requests fan out. Handling one ride request means calling three services, each running as its **own OS process** on a real TCP socket:

```
                  +--> Drivers.Nearby  (50 drivers around you) --+
ride request -->  |                                              +--> pick nearest --> Eta.Estimate
                  +--> Pricing.Quote   (price and surge) --------+
```

Two calls in parallel, then one that depends on their results. The application code (`handleRideRequest`) is identical for REST and gRPC; only the client underneath changes. A counting TCP proxy in front of every service measures the real bytes and connections the same way for both.

## What you'll see (sample run, 3 ms of simulated work per service)

Latency and throughput at different numbers of ride requests in flight:

| in flight | transport | p50 | p99 | req/s |
|---|---|---|---|---|
| 1 | REST | 8.7 ms | 10.7 ms | 115 |
| 1 | gRPC | 9.0 ms | 12.2 ms | 111 |
| 25 | REST | 8.2 ms | 24.6 ms | 2,847 |
| 25 | gRPC | 10.4 ms | 24.5 ms | 2,276 |
| 100 | REST | 20.2 ms | 30.6 ms | 4,747 |
| 100 | gRPC | 16.6 ms | 27.7 ms | 5,793 |

On the wire (50 in flight):

| | bytes per ride request | TCP connections opened |
|---|---|---|
| REST + JSON | ~10.3 KiB | ~150 |
| gRPC + protobuf | ~4.3 KiB | 3 |

## What to notice

- **Bytes and connections are consistent wins for gRPC** (2.4x fewer bytes; 3 connections vs ~150). HTTP/1.1 carries one request per connection at a time, so 50 requests in flight need ~50 connections per service. HTTP/2 multiplexes everything over one.
- **Speed is not a consistent win either way.** REST is slightly ahead at low concurrency, gRPC pulls ahead at 100 in flight (plausibly because it avoids managing ~100 sockets per service, but that is a hypothesis, not something this lab proved).
- **Benchmarks measure your stack, not the protocol.** An earlier version of this lab used hand-written Node `http` code for REST, and REST won at every concurrency level. Switching to Fastify and undici's `fetch` flipped the result at 100 in flight. Same protocol, different implementation, different winner. Always benchmark the stack you would actually run.
- With `WORK_MS` high (try 50), the differences vanish: when services do real work, the transport is rarely the bottleneck.

## Code to read

- `index.mjs`: `handleRideRequest` is the application; the rest is measurement.
- `../../src/harness/cluster.mjs`: how services are started as separate processes.
- `../../src/harness/counting-proxy.mjs`: how bytes are counted fairly across both protocols.
