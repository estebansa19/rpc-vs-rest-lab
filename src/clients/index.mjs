// Both clients expose the SAME methods (nearby, quote, eta), so a lesson's
// application code can't tell which transport is underneath. That's what lets us
// compare them fairly.
import { createRestClient } from './rest-client.mjs';
import { createGrpcClient } from './grpc-client.mjs';

export const createClient = (transport, endpoints) =>
  ({ rest: createRestClient, grpc: createGrpcClient })[transport](endpoints);
