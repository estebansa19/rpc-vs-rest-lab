// One microservice, as its own OS process.
//   node service.mjs <Drivers|Pricing|Eta> <rest|grpc>
// It is launched by lib/cluster.mjs and reports its port back over IPC.
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import { handlers, locationFeed, currentLocation, startLocationTicker } from './lib/handlers.mjs';

const [name, transport] = process.argv.slice(2);
const PROTO = path.join(path.dirname(fileURLToPath(import.meta.url)), 'proto/rides.proto');

startLocationTicker();

// ---------------------------------------------------------------- REST (HTTP/1.1 + JSON)
// The "contract" here is a convention: POST /rides.<Service>/<Method> with a JSON body.
// Nothing enforces it. A typo in a field name is just... a different field.
function startRest() {
  const server = http.createServer(async (req, res) => {
    try {
      const [, svc, method] = req.url.match(/^\/rides\.(\w+)\/(\w+)/) ?? [];
      let out;
      if (svc === 'Drivers' && method === 'Location') {
        out = currentLocation; // polling endpoint: "give me the latest"
      } else {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const input = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
        out = await handlers[svc][method](input);
      }
      const body = JSON.stringify(out);
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
      res.end(body);
    } catch (e) {
      res.writeHead(500).end(String(e));
    }
  });
  server.keepAliveTimeout = 30_000;
  server.listen(0, '127.0.0.1', () => process.send({ port: server.address().port }));
}

// ---------------------------------------------------------------- gRPC (HTTP/2 + protobuf)
// The contract is proto/rides.proto. The framework decodes bytes into typed
// messages BEFORE our handler runs, and rejects anything that doesn't fit.
function startGrpc() {
  const def = protoLoader.loadSync(PROTO, { keepCase: true, longs: Number, defaults: true });
  const pkg = grpc.loadPackageDefinition(def).rides;

  const impl = {};
  for (const method of Object.keys(handlers[name])) {
    impl[method] = (call, cb) =>
      handlers[name][method](call.request).then((r) => cb(null, r), (e) => cb(e));
  }
  if (name === 'Drivers') {
    // Server-streaming: ONE call, many responses, pushed as they happen.
    impl.Track = (call) => {
      const onTick = (loc) => call.write(loc);
      const stop = () => locationFeed.off('tick', onTick);
      locationFeed.on('tick', onTick);
      call.on('cancelled', stop);
      call.on('error', stop);
      call.on('close', stop);
    };
  }

  const server = new grpc.Server();
  server.addService(pkg[name].service, impl);
  server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (err, port) => {
    if (err) throw err;
    process.send({ port });
  });
}

if (transport === 'rest') startRest();
else if (transport === 'grpc') startGrpc();
else throw new Error(`unknown transport: ${transport}`);
