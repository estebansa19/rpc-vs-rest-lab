// A counting TCP proxy. It sits between a client and a service and counts every
// byte that really crosses the wire (HTTP headers, HTTP/2 framing and all), the
// same way for REST and for gRPC. That's the only fair way to compare them.
import net from 'node:net';

export function countingProxy(targetPort) {
  const stats = { bytes: 0, connections: 0 };
  
  const server = net.createServer((client) => {
    stats.connections++;
    const upstream = net.connect(targetPort, '127.0.0.1');
    client.setNoDelay(true);
    upstream.setNoDelay(true);
    client.on('data', (d) => (stats.bytes += d.length));
    upstream.on('data', (d) => (stats.bytes += d.length));
    client.pipe(upstream);
    upstream.pipe(client);
    const kill = () => {
      client.destroy();
      upstream.destroy();
    };
    client.on('error', kill);
    upstream.on('error', kill);
    client.on('close', kill);
    upstream.on('close', kill);
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({
        port: server.address().port,
        stats,
        reset: () => {
          stats.bytes = 0; // connections are kept: they're opened once, during warm-up
        },
        close: () => server.close(),
      }),
    ),
  );
}
