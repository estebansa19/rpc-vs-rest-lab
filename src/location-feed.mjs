// A simulated driver moving through the city, producing a new location every
// `tickMs`. It exists for the streaming lesson:
//   gRPC : the server calls subscribe() and PUSHES every tick to the client.
//   REST : the client has to ask for current() whenever it wants to know.
import { EventEmitter } from 'node:events';
import { SF } from './seed.mjs';

export const TICK_MS = 100;

const locationAt = (seq) => ({
  seq,
  lat: SF.lat + seq * 0.00005,
  lng: SF.lng + seq * 0.00003,
  ts: Date.now(), // when the server produced it; clients use this to measure staleness
  heading: 45,
  speed_kmh: 38,
});

export function createLocationFeed({ tickMs = TICK_MS } = {}) {
  const ticks = new EventEmitter();
  let seq = 0;
  let latest = locationAt(seq);

  const timer = setInterval(() => {
    latest = locationAt(++seq);
    ticks.emit('tick', latest);
  }, tickMs);
  timer.unref(); // don't keep the process alive just for this timer

  return {
    current: () => latest,
    subscribe(onLocation) {
      ticks.on('tick', onLocation);
      return () => ticks.off('tick', onLocation); // call to unsubscribe
    },
  };
}
