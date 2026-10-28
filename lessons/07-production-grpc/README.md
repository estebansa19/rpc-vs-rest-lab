# Lesson 7: what a real gRPC call adds (deadlines, status codes, interceptors)

```bash
npm run lesson7 -- 1     # one step at a time: 1, 2, 3 or 4; each takes under a second
```

## The idea

The hello world shows the shape of RPC: a contract, a stub, a server that dispatches by name. A production gRPC service lives in the parts the hello world leaves out: how long a caller waits, what an error means, and what travels with every call besides the arguments.

## What you'll see (sample runs)

| step | scenario | result |
|---|---|---|
| 1 | client waits 100 ms for a 300 ms quote, server ignores the deadline | client: `DEADLINE_EXCEEDED` at ~110 ms; server still finishes 6/6 chunks at ~320 ms |
| 1 | same, server checks `call.cancelled` | server stops after 2/6 chunks |
| 2 | server answers `UNAVAILABLE` twice | retried; attempt 3 is OK |
| 2 | empty product, server answers `INVALID_ARGUMENT` | 1 attempt, no retry |
| 3 | plain client, server requires a token | `UNAUTHENTICATED` |
| 3 | same call through an interceptor that adds a token and request id | OK |
| 4 | client -> Pricing -> ETA, Pricing gives ETA a fresh 1 s deadline | ETA finishes 6/6 at ~325 ms, long after the client gave up |
| 4 | Pricing passes `call.getDeadline()` down | ETA stops after 2/6 chunks |

## What to notice

- **A deadline doesn't stop the server's code.** gRPC sends the deadline with the request and marks the call cancelled when it passes, but a running handler only stops if it checks `call.cancelled`.
- **The status code decides the retry.** `UNAVAILABLE` is temporary, so retry with backoff. `INVALID_ARGUMENT` will fail the same way every time, so retrying only adds load.
- **Metadata is gRPC's headers; an interceptor is client middleware.** Auth tokens and request ids are added once, where the client is created, not at each call site.
- **A deadline is one budget for the whole request.** Each hop should pass the deadline it received down, not start a new one; otherwise services deeper in the chain keep working for a caller that's gone.
- Left out on purpose: server-side interceptors, health checks, gRPC's built-in retry policy (service config), and TLS.

## Code to read

- `index.mjs`: `step1` (the `call.cancelled` check), `quoteWithRetries` and `RETRYABLE`, `addRequestIdAndToken` (the interceptor), and Pricing's handler in `step4` (`call.getDeadline()`).
