// Entry point for ONE microservice, run as its own OS process:
//
//   node run-service.mjs <Drivers|Pricing|Eta> <rest|grpc>
//
// harness/cluster.mjs launches these. Running each service in a separate process
// is what makes the lessons honest: calls really cross a process boundary and a
// real TCP socket, like they would between deployments.
import { createHandlers } from '../handlers.mjs';
import { createLocationFeed } from '../location-feed.mjs';
import { startRestServer } from './rest-server.mjs';
import { startGrpcServer } from './grpc-server.mjs';

const [service, transport] = process.argv.slice(2);

const handlers = createHandlers({ workMs: Number(process.env.WORK_MS ?? 3) });
const locationFeed = createLocationFeed();

const start = { rest: startRestServer, grpc: startGrpcServer }[transport];
if (!start) throw new Error(`unknown transport "${transport}" (use rest or grpc)`);

const port = await start({ service, handlers, locationFeed });
process.send({ port }); // tell the parent process we're ready, and where
