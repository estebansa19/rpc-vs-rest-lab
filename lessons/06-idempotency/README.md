# Lesson 6: charging exactly once (idempotency)

```bash
npm run lesson6      # takes about 1 second
```

## The idea

An operation is **idempotent** if doing it twice has the same effect as doing it once. `POST /charge` is not: every call takes money.

Between services, replies get lost: a timeout, a restarted pod, a dropped connection. When that happens the client can't tell "the request never arrived" from "it arrived, the work was done, and the reply was lost". Either way it sees only the absence of a reply. Giving up might mean the customer was never charged, so the right move is to **retry**, which is only safe if the operation is idempotent.

An **idempotency key** makes it so. The client creates one unique id per *logical operation* (`crypto.randomUUID()`) and sends it in an `Idempotency-Key` header on the first attempt and every retry. The server remembers key -> result, and for a key it has seen it **replays** the stored result instead of doing the work again.

## What you'll see (sample run; every scenario is one logical charge)

| scenario | replies the client saw | charges made |
|---|---|---|
| lost reply + retry, no key | no reply, 200 ch_2 | 2 |
| lost reply + retry, with key | no reply, 200 ch_1 | 1 |
| two at once, key stored after work | 200 ch_1, 200 ch_2 | 2 |
| two at once, key claimed first | 200 ch_1, 200 ch_1 | 1 |
| same key, different amount | 200 ch_1, 422 key reused with a different body | 1 |

## What to notice

- **Without a key, the retry charges twice**, and the client only ever hears about `ch_2`. Nobody on the client side knows `ch_1` exists.
- **With a key, the retry gets `ch_1` back**: the server replays the answer the lost reply would have carried. The key must be created once per operation, not per attempt.
- **The race.** If the server checks the key, waits for the slow work, and only *then* stores the key, two simultaneous requests both pass the check and both charge. The fix moves one line: store the key **before** the slow part. Node runs one piece of JavaScript at a time and only switches requests at an `await`, so a duplicate that arrives later always finds the key.
- A duplicate that arrives while the first is still running **waits for the first one's result** (the map stores a promise). That's the simplest choice here. Stripe answers `409 Conflict` instead and lets the client retry later, which avoids holding connections open while slow work runs.
- **Same key, different body is rejected with 422.** Replaying would report the wrong charge, and charging would break the key's promise. A reused key is a client bug, so the server surfaces it.
- Left out on purpose: key expiry, storage that survives a restart, and removing the key when the charge *fails* (here a failure would be replayed forever). With more than one server, the in-memory map is replaced by a database table with a **unique constraint** on the key, so only one insert can win.

## Does any of this change over gRPC?

No, the problem and the fix are the same: a gRPC call can lose its reply exactly like HTTP, and `DEADLINE_EXCEEDED` leaves the same "did it run?" doubt. The key would travel as gRPC metadata instead of an HTTP header, and it matters even more there because gRPC can be configured to retry calls automatically.

## Code to read

- `index.mjs`: `startPaymentServer` (the three modes, about 30 lines) and `chargeWithRetries` (where the key is created, once, before the loop).
