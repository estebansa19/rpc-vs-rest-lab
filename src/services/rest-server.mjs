// A service exposed as REST: HTTP/1.1 + JSON, using Fastify (a popular Node web framework).
// Each operation becomes a route; Fastify parses the JSON body for us.
import Fastify from 'fastify';
import { REST_ROUTES } from '../rest-routes.mjs';

export async function startRestServer({ service, handlers, locationFeed }) {
  const app = Fastify();

  for (const [method, handle] of Object.entries(handlers[service])) {
    const { method: verb, path } = REST_ROUTES[`${service}.${method}`];
    app.route({ method: verb, url: path, handler: (request) => handle(request.body) });
  }

  // REST can't push, so "where is the driver now?" is just a route the client polls.
  if (service === 'Drivers') {
    const { method, path } = REST_ROUTES['Drivers.Location'];
    app.route({ method, url: path, handler: () => locationFeed.current() });
  }

  await app.listen({ host: '127.0.0.1', port: 0 }); // port 0 = let the OS pick a free one
  return app.server.address().port;
}
