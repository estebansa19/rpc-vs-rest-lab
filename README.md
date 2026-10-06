# rpc-vs-rest-lab

A hands-on lab for understanding **RPC between microservices**: how it works, why companies like Uber use it, and how it honestly compares to REST/JSON. Everything runs locally with real processes talking over real sockets, and every claim below comes from a script you can run yourself.

> Educational project. The numbers are from a laptop running Node, not a benchmark of any production system. The point is to build intuition and to know what to measure on a real one.

```bash
npm install
npm run part1   # the basics: one call, three ways
npm run part2   # a ride request fanning out to 3 services, under load
npm run part3   # live driver location: streaming vs polling
```

Requires Node 20+. No other tooling (no `protoc`).

---

## 1. The mental model

**REST** models the world as *resources* you act on with a small set of verbs: `GET /drivers/123`, `POST /rides`. The contract is a convention (docs, OpenAPI if someone wrote it). The wire format is usually JSON over HTTP/1.1.

**RPC** (Remote Procedure Call) models the world as *functions you call on another machine*: `Pricing.Quote(origin, dest)`. You call it like a local function; a framework turns the arguments into bytes, ships them, runs the function remotely, and returns the result. **gRPC** is the most common modern RPC framework: the contract is a `.proto` file, the wire format is protobuf, and the transport is HTTP/2.

| | REST + JSON | gRPC + protobuf |
|---|---|---|
| Contract | Convention / optional spec | `.proto` file, required, shared by both sides |
| Wire format | Text (JSON), field names in every message | Binary, field *numbers* only |
| Transport | Usually HTTP/1.1 | HTTP/2 (multiplexed, one connection) |
| Streaming | Awkward (polling, SSE, WebSockets) | Built in (server, client, bidirectional) |
| Codegen | Optional | Standard: clients and server stubs in any language |
| Debugging | `curl`, browser, eyeballing JSON | Needs tooling (`grpcurl`, reflection) |
| Browser clients | Native | Needs a proxy (gRPC-Web) |

## 2. What the lab shows

### Part 1: the basics (`part1-basics.mjs`)

**One call costs more than you think.** Same `Pricing.Quote` logic, free work, sequential calls:

| how we call it | mean |
|---|---|
| in-process function call | ~0 µs |
| REST + JSON | ~55 µs |
| gRPC + protobuf | ~101 µs |

Any network hop is orders of magnitude more than a function call, and a real request path has many hops. (Yes, gRPC is *slower* here. See "Honest results" below.)

**The wire:** the same Quote is 50 bytes of JSON and 17 bytes of protobuf. The protobuf has no field names, just numbers, so both sides need the `.proto` to read it. For 50 drivers: JSON 8.5 KiB, protobuf 3.7 KiB, but gzipped JSON is 1.9 KiB, so **size alone is not the argument.**

**Contract evolution:** a server renames `currency` to `currency_code` and adds a field. An old gRPC client keeps working (the wire carries field number 2, not the name). An old REST client silently gets `undefined`. The caveat is also demonstrated: proto3 turns a missing field into a default (`0`), not an error. The tooling (`buf breaking`, `reserved`) exists, but you have to use it.

### Part 2: a realistic request path (`part2-ride-request.mjs`)

Three services (Drivers, Pricing, ETA) run as **separate OS processes**. A dispatcher handles a ride request: `Nearby` and `Quote` in parallel, pick the nearest driver, then `Estimate` the ETA. The same handler code serves both REST and gRPC, so any difference is the transport. A counting TCP proxy in front of every service measures real wire bytes for both.

Sample run (your numbers will differ):

| | REST + JSON | gRPC + protobuf |
|---|---|---|
| Bytes on the wire per ride request (headers and framing included) | **9.7 KiB** | **4.1 KiB** |
| TCP connections opened at 50 concurrent requests | ~112–138 | 3 |
| p50 latency at 100 concurrent | ~8 ms | ~12 ms |
| Throughput at 100 concurrent | ~10,000 req/s | ~7,600 req/s |

### Part 3: streaming (`part3-streaming.mjs`)

A driver's location changes 10x per second.

| approach | requests | updates seen | avg staleness | bytes |
|---|---|---|---|---|
| gRPC stream | 1 | 39 / ~40 | 52 ms (the floor) | 2.2 KiB |
| REST poll @100 ms | 40 | 40 / ~40 | 78 ms | 13.2 KiB |
| REST poll @500 ms | 8 | 8 / ~40 | 319 ms | 2.7 KiB |

With polling you choose between cost and freshness. A server-push stream doesn't make you choose.

## 3. Honest results: when RPC did *not* win

On this setup **REST was faster per call and had higher throughput than gRPC.** That's the opposite of the folklore, and worth understanding:

- `grpc-js` is a pure-JavaScript HTTP/2 implementation, and protobuf encoding in JS competes against `JSON.stringify`, which V8 runs as highly optimized native code. Node's HTTP/1.1 parser is also native.
- Over `localhost` there is no bandwidth cost and no real latency, so the savings from smaller messages and fewer connections don't show up in time.
- The measured RPC wins here are **bytes (2.4x fewer), connections (3 vs 100+), the contract, and streaming.** Those are real, but they're not "gRPC is faster in Node".

This is a hypothesis, not something the lab proved. To test it you'd run the same comparison in Go or Java (native protobuf and HTTP/2) and across a real network.

## 4. So why does a company like Uber use RPC internally?

Based on the above, the reasons that hold up are about **scale and organization**, not raw speed:

1. **A typed, shared contract.** With thousands of services owned by different teams, "what does this endpoint return?" can't live in a wiki. The `.proto` is the source of truth, and breaking changes can be caught in CI.
2. **Polyglot codegen.** Services in Go, Java, Python, Node all get generated clients from one file. No hand-written, drifting SDKs.
3. **Efficiency adds up.** A few KiB saved per call is nothing once. Multiplied by billions of internal calls per day and by every hop in a deep call graph, it's bandwidth, CPU and money.
4. **Streaming and long-lived connections.** Live location, dispatch and pricing updates are push problems (Part 3).
5. **Cross-cutting features for free.** Deadlines, cancellation propagation, retries and load-balancing hooks are built into the framework.

Uber has publicly described building its own RPC stack (TChannel, Thrift, then YARPC with gRPC and protobuf support). Check Uber's engineering blog for the current details, since I haven't verified them here.

**Where RPC is the wrong tool:** public APIs consumed by unknown third parties and browsers (REST/GraphQL win on reach and debuggability), small teams with a handful of services (the contract machinery is overhead), and anything where being able to `curl` it matters more than a few KiB.

## 5. Try it yourself

1. In `proto/rides.proto`, add a field to `Driver`. Run Part 2. Nothing breaks. Now *change a field number* and see what happens to the decoded data.
2. In `lib/handlers.mjs`, set `WORK_MS` high (50). Watch the transport difference vanish: when the work dominates, the transport barely matters.
3. Make the dispatcher call the three services *sequentially* instead of in parallel. Your per-hop overhead now multiplies.
4. **Apply it to a real system** (the whole point): pick two services you work with, measure bytes and latency per call between them, and decide whether an RPC contract would fix a problem you actually have.

## 6. Layout

```
proto/rides.proto      the contract
service.mjs            one microservice (REST or gRPC), run as its own process
lib/handlers.mjs       business logic, shared by both transports
lib/cluster.mjs        spawns services as separate processes
lib/clients.mjs        REST and gRPC clients behind one interface
lib/proxy.mjs          counting TCP proxy (measures real wire bytes)
part1-basics.mjs       call cost, wire format, contract evolution
part2-ride-request.mjs fan-out under load
part3-streaming.mjs    push vs poll
```
