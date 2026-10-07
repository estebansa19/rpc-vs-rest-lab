// Fake but repeatable data, so REST and gRPC always return identical payloads
// and a benchmark compares the same bytes every run.

import { faker } from '@faker-js/faker';

export const SF = { lat: 37.7749, lng: -122.4194 };

const seedFrom = ({ lat, lng }) => Math.round(Math.abs(lat * 1e4)) * 31 + Math.round(Math.abs(lng * 1e4));
const toPoint = ([lat, lng]) => ({ lat, lng });
const around = (center, radiusKm) =>
  toPoint(faker.location.nearbyGPSCoordinate({ origin: [center.lat, center.lng], radius: radiusKm, isMetric: true }));

// Generating fake data is slow compared to the transport work we want to measure.
// So each place's drivers are generated once and cached: after that, a "database
// lookup" in a handler costs nothing, and lessons measure transport, not faker.
const driversByPlace = new Map();

// `n` drivers scattered within 3 km of `origin`.
export function makeDrivers(n, origin) {
  const key = `${seedFrom(origin)}:${n}`;
  if (!driversByPlace.has(key)) {
    faker.seed(seedFrom(origin));
    driversByPlace.set(
      key,
      Array.from({ length: n }, () => ({
        id: `drv_${faker.string.numeric(6)}`,
        name: faker.person.fullName(),
        location: around(origin, 3),
        rating: faker.number.float({ min: 4.2, max: 5, fractionDigits: 2 }),
        vehicle: faker.vehicle.vehicle(),
        available: faker.datatype.boolean({ probability: 0.8 }),
        trips: faker.number.int({ max: 9000 }),
      })),
    );
  }
  return driversByPlace.get(key);
}

// A surge multiplier for a place: mostly 1.0, sometimes busy. A plain lookup, no faker.
const SURGE_LEVELS = [1.0, 1.0, 1.2, 1.5, 2.0];
export const surgeFor = (origin) => SURGE_LEVELS[seedFrom(origin) % SURGE_LEVELS.length];

// The i-th ride request of a test run: a pickup and a drop-off around San Francisco.
// Only 100 distinct rides, repeated, so the driver cache above is warm after the first 100.
export function makeRideRequest(i) {
  faker.seed((i % 100) + 1);
  return { origin: around(SF, 4), dest: around(SF, 8), product: 'uberx' };
}
