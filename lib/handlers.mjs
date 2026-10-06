// The business logic, written once. Both the REST server and the gRPC server
// call exactly these functions, so any difference we measure is the TRANSPORT,
// not the work.
import { EventEmitter } from 'node:events';
import { SF, makeDrivers, haversineKm } from './data.mjs';

// Simulated downstream work (a DB lookup, a cache miss...). 0 = pure overhead.
const WORK_MS = Number(process.env.WORK_MS ?? 3);
const work = () => (WORK_MS > 0 ? new Promise((r) => setTimeout(r, WORK_MS)) : undefined);

export const handlers = {
  Drivers: {
    async Nearby({ origin, limit }) {
      await work();
      return { drivers: makeDrivers(limit || 50, origin) };
    },
  },
  Pricing: {
    async Quote({ origin, dest }) {
      await work();
      const km = haversineKm(origin, dest);
      const surge = 1 + (Math.round(origin.lat * 1e4) % 8) / 10;
      return {
        amount_cents: Math.round((250 + km * 135) * surge),
        currency: 'USD',
        surge,
      };
    },
  },
  Eta: {
    async Estimate({ from, to }) {
      await work();
      return { seconds: Math.round((haversineKm(from, to) / 30) * 3600) + 60 };
    },
  },
};

// ---- Live driver location (used by the streaming demo) ---------------------
// One simulated driver, moving, updated 10x per second. gRPC pushes every tick
// to subscribers; REST can only hand out "the latest" when asked.
export const TICK_MS = 100;
export const locationFeed = new EventEmitter();
let seq = 0;
export let currentLocation = makeLocation(0);

function makeLocation(n) {
  return {
    seq: n,
    lat: SF.lat + n * 0.00005,
    lng: SF.lng + n * 0.00003,
    ts: Date.now(),
    heading: 45,
    speed_kmh: 38,
  };
}

export function startLocationTicker() {
  const t = setInterval(() => {
    currentLocation = makeLocation(++seq);
    locationFeed.emit('tick', currentLocation);
  }, TICK_MS);
  t.unref();
}
