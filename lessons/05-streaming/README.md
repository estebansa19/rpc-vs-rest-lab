# Lesson 5: live driver location (streaming)

```bash
npm run lesson5      # takes about 15 seconds
```

## The idea

Some data is not a question you ask, it's a feed that changes. A rider watching a driver approach needs a new location every 100 ms.

- **REST** is request/response: the client must **pull** ("polling"), and has to choose how often.
- **gRPC** supports **server streaming**: the client makes one call and the server **pushes** each update as it happens.

## What you'll see (sample run, 4 seconds, the server emits 10 updates per second)

| approach | requests | updates received | avg map staleness | bytes on wire |
|---|---|---|---|---|
| gRPC stream | 1 | 39 / ~40 | 52 ms | 2.2 KiB |
| REST poll every 100 ms | 39 | 39 / ~40 | 112 ms | 17.6 KiB |
| REST poll every 500 ms | 8 | 8 / ~40 | 265 ms | 3.6 KiB |

"Map staleness" is how old the newest location is, on average, if you sampled the rider's screen every 10 ms.

## What to notice

- Updates only exist every 100 ms, so even a perfect push leaves the screen about **50 ms** stale on average. That is the floor, and the stream sits right on it.
- **Polling fast** catches every update but pays a full HTTP request for each one: ~8x the bytes of the stream, and the screen is still further behind the floor.
- **Polling slow** is cheap but you see only 8 of ~40 updates and the screen lags by hundreds of ms.
- With polling you are choosing between cost and freshness. A stream doesn't make you choose. This is the clearest case where RPC is not just "REST but smaller".

## Code to read

- `index.mjs`: the two approaches side by side.
- `../../src/services/grpc-server.mjs` (the `Track` handler) vs `rest-server.mjs` (the polling route): about 5 lines each, very different models.
