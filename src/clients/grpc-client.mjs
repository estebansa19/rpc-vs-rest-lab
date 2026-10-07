// A gRPC client. The generated stub (from the .proto) already knows every method
// and message shape, so there are no URLs and no manual JSON.
import { promisify } from 'node:util';
import grpc from '@grpc/grpc-js';
import { rides } from '../proto.mjs';

export function createGrpcClient(endpoints) {
  // One stub per service = one HTTP/2 connection per service. HTTP/2 multiplexes
  // any number of concurrent calls over that single connection.
  const stubs = {};
  const stubFor = (service) =>
    (stubs[service] ??= new rides[service](`127.0.0.1:${endpoints[service]}`, grpc.credentials.createInsecure()));

  // grpc-js stubs use callbacks; promisify turns them into promises.
  const call = (service, method, request) => {
    const stub = stubFor(service);
    return promisify(stub[method].bind(stub))(request);
  };

  return {
    nearby: (request) => call('Drivers', 'Nearby', request),
    quote: (request) => call('Pricing', 'Quote', request),
    eta: (request) => call('Eta', 'Estimate', request),

    // Server-streaming: one call, then `onLocation` fires for every message pushed.
    track(request, onLocation) {
      const stream = stubFor('Drivers').Track(request);
      stream.on('data', onLocation);
      stream.on('error', () => {}); // cancel() below surfaces as an error; that's expected
      return { cancel: () => stream.cancel() };
    },

    close: () => Object.values(stubs).forEach((stub) => stub.close()),
  };
}
