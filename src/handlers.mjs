// The business logic, written ONCE as plain async functions.
//
// Both the REST server and the gRPC server call these exact functions, so when a
// lesson measures a difference, it is the TRANSPORT that differs, not the work.
import { setTimeout as sleep } from 'node:timers/promises';
import { getDistance } from 'geolib';
import { makeDrivers, surgeFor } from './seed.mjs';

const CITY_SPEED_M_PER_S = 30 / 3.6; // 30 km/h

// workMs simulates what a real service does besides serializing: a DB query, a
// cache miss, a call to something else. 0 means "measure pure transport overhead".
export function createHandlers({ workMs = 3 } = {}) {
  const doWork = () => (workMs > 0 ? sleep(workMs) : undefined);

  return {
    Drivers: {
      async Nearby({ origin, limit }) {
        await doWork();
        return { drivers: makeDrivers(limit || 50, origin) };
      },
    },

    Pricing: {
      async Quote({ origin, dest }) {
        await doWork();
        const km = getDistance(origin, dest) / 1000;
        const surge = surgeFor(origin);
        return { amount_cents: Math.round((250 + km * 135) * surge), currency: 'USD', surge };
      },
    },

    Eta: {
      async Estimate({ from, to }) {
        await doWork();
        return { seconds: Math.round(getDistance(from, to) / CITY_SPEED_M_PER_S) + 60 };
      },
    },
  };
}
