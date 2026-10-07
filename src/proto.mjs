// Loads the gRPC contract (proto/rides.proto) once, for everyone who needs it.
//
// `rides` ends up looking like:
//   rides.Pricing        -> a client class:   new rides.Pricing(address, credentials)
//   rides.Pricing.service -> the service definition a server registers handlers on
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';

export const PROTO_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '../proto/rides.proto');

const definition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true, // keep snake_case names, so gRPC and JSON use the same field names
  longs: Number, // int64 -> plain JS number (default would be a Long object)
  defaults: true, // fill in missing fields with proto3 defaults (0, "", false)
});

export const rides = grpc.loadPackageDefinition(definition).rides;
