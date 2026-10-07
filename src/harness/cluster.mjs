// Starts the services as separate OS processes (like separate deployments) and
// hands back where each one is listening.
//
// With `proxy: true`, a counting proxy is placed in front of every service so a
// lesson can measure the real bytes and connections (see counting-proxy.mjs).
import { fork } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startCountingProxy } from './counting-proxy.mjs';

const RUN_SERVICE = path.join(path.dirname(fileURLToPath(import.meta.url)), '../services/run-service.mjs');

export async function startServices(transport, { only = ['Drivers', 'Pricing', 'Eta'], workMs = 3, proxy = false } = {}) {
  const children = [];
  const proxies = [];
  const endpoints = {}; // service name -> port the CLIENT should connect to

  for (const service of only) {
    const child = fork(RUN_SERVICE, [service, transport], { env: { ...process.env, WORK_MS: String(workMs) } });
    children.push(child);

    // The child sends { port } over IPC once it is listening.
    const { port } = await new Promise((resolve, reject) => {
      child.once('message', resolve);
      child.once('exit', (code) => reject(new Error(`${service} exited before it was ready (code ${code})`)));
    });

    if (proxy) {
      const counting = await startCountingProxy(port);
      proxies.push(counting);
      endpoints[service] = counting.port;
    } else {
      endpoints[service] = port;
    }
  }

  return {
    endpoints,
    // Totals across all proxied services since the last resetWireBytes().
    wire: () => ({
      bytes: proxies.reduce((sum, p) => sum + p.stats.bytes, 0),
      connections: proxies.reduce((sum, p) => sum + p.stats.connections, 0),
    }),
    // Clears bytes only: connections are opened once, during warm-up, and we
    // still want to count them.
    resetWireBytes: () => proxies.forEach((p) => (p.stats.bytes = 0)),
    stop() {
      proxies.forEach((p) => p.close());
      children.forEach((child) => {
        child.removeAllListeners('exit');
        child.kill();
      });
    },
  };
}
