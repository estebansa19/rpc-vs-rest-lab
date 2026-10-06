// Deterministic fake data, so REST and gRPC always return identical payloads.

export const SF = { lat: 37.7749, lng: -122.4194 };

function rng(seed) {
  let a = seed >>> 0;

  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ['Ana', 'Luis', 'Maya', 'Omar', 'Priya', 'Chen', 'Sofia', 'Jonas', 'Aisha', 'Diego'];
const LAST = ['Rivera', 'Okafor', 'Nguyen', 'Silva', 'Kowalski', 'Haddad', 'Tanaka', 'Moreau'];
const VEHICLES = ['Toyota Prius', 'Honda Accord', 'Tesla Model 3', 'Hyundai Ioniq', 'Ford Fusion'];

export function makeDrivers(n, origin) {
  const r = rng(Math.round(origin.lat * 1e4) ^ Math.round(origin.lng * 1e4));
  
  return Array.from({ length: n }, (_, i) => ({
    id: `drv_${String(100000 + Math.floor(r() * 899999))}`,
    name: `${FIRST[Math.floor(r() * FIRST.length)]} ${LAST[Math.floor(r() * LAST.length)]}`,
    location: {
      lat: origin.lat + (r() - 0.5) * 0.04,
      lng: origin.lng + (r() - 0.5) * 0.04,
    },
    rating: Math.round((4.2 + r() * 0.8) * 100) / 100,
    vehicle: VEHICLES[Math.floor(r() * VEHICLES.length)],
    available: r() > 0.2,
    trips: Math.floor(r() * 9000),
  }));
}

export function haversineKm(a, b) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// A random-ish but repeatable ride request near San Francisco.
export function makeRideRequest(i) {
  const r = rng(i + 1);
  return {
    origin: { lat: SF.lat + (r() - 0.5) * 0.06, lng: SF.lng + (r() - 0.5) * 0.06 },
    dest: { lat: SF.lat + (r() - 0.5) * 0.12, lng: SF.lng + (r() - 0.5) * 0.12 },
    product: 'uberx',
  };
}
