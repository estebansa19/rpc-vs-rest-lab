# Lesson 3: what happens when the contract changes?

```bash
npm run lesson3
```

## The idea

In a company with many teams, services are upgraded on different days. An **old client will routinely talk to a new server**. The question is what breaks.

No network is needed here: the "new server" encodes a response, and an "old client" decodes it.

The change in version 2 of the service: rename `currency` to `currency_code`, and add a new field `surge_reason`.

## What you'll see

```
Old gRPC client sees: { amount_cents: 1450, currency: 'USD', surge: 1.4 }
Old REST client reads quote.currency: undefined
```

- **Protobuf:** the old client still gets `currency: 'USD'`. On the wire a field is identified by its **number** (here, 2), not its name, so the rename is invisible. The new field is ignored.
- **JSON:** the key is literally the name, so the rename silently breaks the old client. Nothing fails at the boundary; the bug shows up later as `undefined` in a UI.

## The catch (lesson 3b)

If the server stops sending `amount_cents` entirely, the old protobuf client reads `0`, the proto3 default, and **no error is raised**. Protobuf does not make breaking changes impossible. It makes them *detectable by tooling*: `reserved` field numbers, and a `buf breaking` check in CI that fails a pull request which breaks the contract. You have to adopt that discipline.

## What to notice

- Field numbers are the real identity of a field. **Never reuse or renumber one.**
- A shared contract only helps if something enforces it. That is the case for RPC at scale, and also its cost: more process.

## Code to read

- `index.mjs`: two versions of the same message defined inline, so you can see the one-line differences.
