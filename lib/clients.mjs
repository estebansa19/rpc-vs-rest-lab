// Two clients with the SAME interface: nearby(), quote(), eta().
// The caller (the "Dispatch" code) can't tell which transport is underneath,
// which is exactly the point of the comparison.
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';

const PROTO = path.join(path.dirname(fileURLToPath(import.meta.url)), '../proto/rides.proto');

export function makeClient(transport, endpoints) {
  return transport === 'rest' ? restClient(endpoints) : grpcClient(endpoints);
}

// ------------------------------------------------------------------ REST
function restClient(endpoints) {
  // keep-alive: reuse TCP connections (what any sane production client does).
  // HTTP/1.1 carries ONE request per connection at a time, so N concurrent
  // requests need N sockets.
  const agent = new http.Agent({ keepAlive: true, maxSockets: Infinity });

  const call = (svc, method, body, verb = 'POST') =>
    new Promise((resolve, reject) => {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const req = http.request(
        {
          host: '127.0.0.1',
          port: endpoints[svc],
          method: verb,
          path: `/rides.${svc}/${method}`,
          agent,
          headers: payload
            ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }
            : {},
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString();
            res.statusCode === 200 ? resolve(JSON.parse(text)) : reject(new Error(text));
          });
        },
      );
      req.on('error', reject);
      req.end(payload);
    });

  return {
    nearby: (r) => call('Drivers', 'Nearby', r),
    quote: (r) => call('Pricing', 'Quote', r),
    eta: (r) => call('Eta', 'Estimate', r),
    latestLocation: () => call('Drivers', 'Location', undefined, 'GET'),
    close: () => agent.destroy(),
  };
}

// ------------------------------------------------------------------ gRPC
function grpcClient(endpoints) {
  const def = protoLoader.loadSync(PROTO, { keepCase: true, longs: Number, defaults: true });
  const pkg = grpc.loadPackageDefinition(def).rides;
  const creds = grpc.credentials.createInsecure();
  // ONE channel per service: one HTTP/2 connection, many concurrent calls multiplexed on it.
  const stubs = {
    Drivers: new pkg.Drivers(`127.0.0.1:${endpoints.Drivers ?? 0}`, creds),
    Pricing: new pkg.Pricing(`127.0.0.1:${endpoints.Pricing ?? 0}`, creds),
    Eta: new pkg.Eta(`127.0.0.1:${endpoints.Eta ?? 0}`, creds),
  };
  const unary = (svc, method, req) =>
    new Promise((resolve, reject) =>
      stubs[svc][method](req, (err, res) => (err ? reject(err) : resolve(res))),
    );

  return {
    nearby: (r) => unary('Drivers', 'Nearby', r),
    quote: (r) => unary('Pricing', 'Quote', r),
    eta: (r) => unary('Eta', 'Estimate', r),
    // One call, many pushed responses.
    track(req, onMessage) {
      const stream = stubs.Drivers.Track(req);
      stream.on('data', onMessage);
      stream.on('error', () => {}); // cancel() surfaces as an error; expected
      return { cancel: () => stream.cancel() };
    },
    close: () => Object.values(stubs).forEach((s) => s.close()),
  };
}
