// A service exposed as gRPC: HTTP/2 + protobuf.
// The contract (proto/rides.proto) tells grpc-js how to decode each request into
// an object BEFORE our handler runs, and how to encode the result afterwards.
import grpc from '@grpc/grpc-js';
import { rides } from '../proto.mjs';

export async function startGrpcServer({ service, handlers, locationFeed }) {
  // grpc-js handlers are callback-style: (call, callback). Ours are async
  // functions, so adapt each one: call.request is the already-decoded message.
  const implementation = {};
  for (const [method, handle] of Object.entries(handlers[service])) {
    implementation[method] = (call, callback) =>
      handle(call.request).then((response) => callback(null, response), callback);
  }

  if (service === 'Drivers') {
    // Server-streaming: ONE call from the client, then we keep writing messages
    // to it for as long as the client listens. Nothing is polled.
    implementation.Track = (call) => {
      const unsubscribe = locationFeed.subscribe((location) => call.write(location));
      call.on('cancelled', unsubscribe);
      call.on('close', unsubscribe);
      call.on('error', unsubscribe);
    };
  }

  const server = new grpc.Server();
  server.addService(rides[service].service, implementation);

  return new Promise((resolve, reject) =>
    server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (error, port) =>
      error ? reject(error) : resolve(port),
    ),
  );
}
