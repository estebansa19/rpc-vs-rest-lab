// A TCP proxy that forwards everything untouched and counts the bytes.
//
//   client  <-->  counting proxy  <-->  service
//
// Because it works at the TCP level, it sees EVERYTHING that crosses the wire:
// HTTP headers, HTTP/2 framing, protobuf or JSON, both directions. It treats REST
// and gRPC identically, which is the only fair way to compare them.
import net from 'node:net';

export function startCountingProxy(targetPort) {
  const stats = { bytes: 0, connections: 0 };

  const server = net.createServer((client) => {
    stats.connections++;
    const service = net.connect(targetPort, '127.0.0.1');

    client.on('data', (chunk) => (stats.bytes += chunk.length));
    service.on('data', (chunk) => (stats.bytes += chunk.length));
    client.pipe(service);
    service.pipe(client);

    // If either side closes or errors, tear down the other.
    const closeBoth = () => {
      client.destroy();
      service.destroy();
    };
    for (const socket of [client, service]) {
      socket.on('error', closeBoth);
      socket.on('close', closeBoth);
    }
  });

  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({ port: server.address().port, stats, close: () => server.close() }),
    ),
  );
}
