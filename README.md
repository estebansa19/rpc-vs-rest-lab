# rpc-vs-rest-lab

A hands-on lab for understanding **RPC between microservices**: how it works, why companies like Uber use it, and how it honestly compares to REST/JSON. Everything runs locally, with real processes talking over real sockets, and every claim in these docs comes from a script you can run yourself.

> Educational project. Numbers come from one laptop running Node, not from a production system. The goal is to build intuition and to know what to measure on a real one.

```bash
npm install
npm run all          # or run one lesson at a time, below
```

Requires Node 20+. No other tooling (no `protoc`).

## The lessons

Read them in order. Each folder has a short README (the explanation) and an `index.mjs` (the experiment).

| # | Lesson | Question it answers |
|---|---|---|
| 1 | [`01-call-cost`](lessons/01-call-cost) | What does one network call cost compared to a function call? |
| 2 | [`02-wire-format`](lessons/02-wire-format) | What do JSON and protobuf actually look like on the wire? |
| 3 | [`03-contract-evolution`](lessons/03-contract-evolution) | What breaks when a service changes and its callers haven't? |
| 4 | [`04-ride-request`](lessons/04-ride-request) | How do they compare in a realistic multi-service request, under load? |
| 5 | [`05-streaming`](lessons/05-streaming) | What can RPC do that request/response can't? |

## The mental model

**REST** models the world as *resources* you act on with a few verbs: `POST /quotes`, `GET /drivers/123`. The contract is a convention (docs, maybe an OpenAPI file). The usual wire format is JSON over HTTP/1.1.

**RPC** (Remote Procedure Call) models the world as *functions on another machine*: `Pricing.Quote(origin, dest)`. You call it like a local function; a framework serializes the arguments, sends them, runs the function remotely and returns the result. **gRPC** is the most common modern RPC framework: the contract is a `.proto` file, the format is protobuf, the transport is HTTP/2.

| | REST + JSON | gRPC + protobuf |
|---|---|---|
| Contract | Convention / optional spec | `.proto` file, required, shared by both sides |
| Wire format | Text; field names repeated in every message | Binary; field *numbers* only |
| Transport | Usually HTTP/1.1 | HTTP/2 (many calls multiplexed on one connection) |
| Streaming | Awkward (polling, SSE, WebSockets) | Built in (server, client, bidirectional) |
| Client code | Hand-written or optional codegen | Generated from the contract |
| Debugging | `curl`, browser, read the JSON | Needs tooling (`grpcurl`, reflection) |
| Browser clients | Native | Needs a proxy (gRPC-Web) |

## What the lab found

| Question | Result in this lab |
|---|---|
| Is a network call expensive? | Yes: ~100x a function call, for REST and gRPC alike (lesson 1) |
| Is protobuf smaller? | ~2x smaller than JSON, but with gzip they're nearly equal (lesson 2) |
| Does the contract help? | Renames and additions are safe in protobuf, silently breaking in JSON, but missing fields default to `0` unless you add tooling (lesson 3) |
| Fewer bytes and connections? | **Yes, consistently:** ~2.4x fewer bytes, 3 connections vs ~150 (lesson 4) |
| Is gRPC faster? | **Mixed:** REST slightly ahead at low concurrency, gRPC ahead at 100 in flight (lesson 4) |
| Streaming? | **A real difference:** push gives freshness *and* low cost; polling forces a trade-off (lesson 5) |

## So why does a company like Uber use RPC internally?

The reasons that hold up are about **scale and organization**, not raw speed:

1. **A typed, shared contract.** With thousands of services owned by different teams, "what does this endpoint return?" can't live in a wiki. The `.proto` is the source of truth, and breaking changes can be caught in CI (lesson 3).
2. **Generated clients in every language.** Services in Go, Java, Python and Node all get clients from one file, with no hand-written SDKs drifting apart.
3. **Efficiency adds up.** A few KiB saved per call is nothing once; multiplied by billions of internal calls and every hop in a deep call graph, it is bandwidth, CPU and money (lesson 4).
4. **Streaming.** Live location, dispatch and price updates are push problems (lesson 5).
5. **Cross-cutting features.** Deadlines, cancellation, retries and load-balancing hooks come with the framework.

Uber has publicly described building its own RPC stack (TChannel, Thrift, then YARPC with gRPC and protobuf support). That is from memory and not verified here, so check Uber's engineering blog before citing it.

**Where RPC is the wrong tool:** public APIs used by unknown third parties and browsers (REST and GraphQL win on reach and debuggability), small teams with a handful of services (the contract machinery is overhead), and anything where being able to `curl` it matters more than a few KiB.

## How the code is organized

```
proto/rides.proto         the gRPC contract (compare with src/rest-routes.mjs, REST's)
lessons/                  the five lessons: README + index.mjs each
src/
  handlers.mjs            business logic, written once, used by both transports
  seed.mjs                fake but repeatable data (faker)
  location-feed.mjs       the simulated moving driver
  rest-routes.mjs         REST's "contract": which verb and URL per operation
  proto.mjs               loads the .proto once
  services/               one microservice per process: REST (Fastify) or gRPC
  clients/                REST (undici fetch) and gRPC clients, same interface
  harness/                process launcher, counting proxy, reporting helpers
``` 

## Try it yourself

1. In `proto/rides.proto`, add a field to `Driver` and run lesson 4: nothing breaks. Now *change a field number* and look at the decoded data.
2. In `lessons/04-ride-request/index.mjs`, raise `WORK_MS` from 3 to 50 and run it: the transport differences nearly vanish.
3. In lesson 4's `handleRideRequest`, call the services one after another instead of with `Promise.all`: per-hop cost now adds up.
