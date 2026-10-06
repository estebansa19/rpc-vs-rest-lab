// Spawns each service as a separate OS process, like separate deployments.
// Optionally puts a counting proxy in front of each so we can measure wire bytes.
import { fork } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { countingProxy } from './proxy.mjs';

const SERVICE = path.join(path.dirname(fileURLToPath(import.meta.url)), '../service.mjs');

export async function startServices(transport, { only = ['Drivers', 'Pricing', 'Eta'], work = 3, proxy = false } = {}) {
  const children = [];
  const proxies = [];
  const endpoints = {};

  for (const name of only) {
    const child = fork(SERVICE, [name, transport], { env: { ...process.env, WORK_MS: String(work) } });
    children.push(child);
    const { port } = await new Promise((resolve, reject) => {
      child.once('message', resolve);
      child.once('error', reject);
      child.once('exit', (c) => reject(new Error(`${name} exited early (${c})`)));
    });
    if (proxy) {
      const p = await countingProxy(port);
      proxies.push(p);
      endpoints[name] = p.port;
    } else {
      endpoints[name] = port;
    }
  }

  return {
    endpoints,
    wire: () => ({
      bytes: proxies.reduce((s, p) => s + p.stats.bytes, 0),
      connections: proxies.reduce((s, p) => s + p.stats.connections, 0),
    }),
    resetWire: () => proxies.forEach((p) => p.reset()),
    async stop() {
      proxies.forEach((p) => p.close());
      children.forEach((c) => c.removeAllListeners('exit'));
      children.forEach((c) => c.kill());
    },
  };
}
