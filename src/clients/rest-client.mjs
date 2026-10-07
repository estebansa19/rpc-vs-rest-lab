// A REST client. Every call: build a URL, serialize to JSON, send, parse JSON back.
// Uses undici's fetch (the engine behind Node's built-in fetch) so we can hold a
// connection pool (`Agent`) and close it when we're done.
import { fetch, Agent } from 'undici';
import { REST_ROUTES } from '../rest-routes.mjs';

export function createRestClient(endpoints) {
  // HTTP/1.1 carries one request per connection at a time, so N concurrent
  // requests need N connections. The Agent keeps them open for reuse (keep-alive).
  const agent = new Agent();

  async function call(operation, body) {
    const { method, path } = REST_ROUTES[operation];
    const service = operation.split('.')[0];
    const response = await fetch(`http://127.0.0.1:${endpoints[service]}${path}`, {
      method,
      dispatcher: agent,
      headers: body && { 'content-type': 'application/json' },
      body: body && JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`${operation} failed: HTTP ${response.status}`);
    return response.json();
  }

  return {
    nearby: (request) => call('Drivers.Nearby', request),
    quote: (request) => call('Pricing.Quote', request),
    eta: (request) => call('Eta.Estimate', request),
    latestLocation: () => call('Drivers.Location'),
    close: () => agent.close(),
  };
}
