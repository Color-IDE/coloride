const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { performance } = require('node:perf_hooks');
const { waitForSidecarHealth } = require('../../../client/desktop/src/sidecar-health.cjs');

// Exercise the production discovery decision without creating Electron windows
// or loading an installed user's persistent terminal profile.
const mainSource = fs.readFileSync(path.resolve(__dirname, '../../../client/desktop/src/main.cjs'), 'utf8');
const functionStart = mainSource.indexOf('async function readReusableSidecar()');
const functionEnd = mainSource.indexOf('\nasync function startSidecar()', functionStart);
assert(functionStart >= 0 && functionEnd > functionStart);
const discoverySource = mainSource.slice(functionStart, functionEnd);

async function fixture(handler, overrides = {}) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coloride-discovery-test-'));
  const discovery = path.join(directory, 'terminal-host.json');
  const config = { host: '127.0.0.1', port: server.address().port, token: 'disposable-test-token', terminalHostVersion: 5 };
  fs.writeFileSync(discovery, JSON.stringify(config), { mode: 0o600 });
  const context = { fs, fetch, Error,
    // Keep the production retry/refusal decision; shorten only its timers.
    waitForSidecarHealth: (config, options) => waitForSidecarHealth(config, {
      timeoutMs: 200, requestTimeoutMs: 40, retryIntervalMs: 10, ...options,
    }),
    cloudConfig: { enabled: false, appBase: "", apiBase: "" },
    sidecarDiscoveryPath: () => discovery, isDev: () => false, TERMINAL_HOST_VERSION: 5, console, ...overrides };
  vm.runInNewContext(`${discoverySource}; this.readReusable = readReusableSidecar;`, context);
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  };
  return { config, discovery, read: context.readReusable, stop,
    cleanup: async () => { await stop(); fs.rmSync(directory, { recursive: true }); } };
}

test('dead persistent discovery is discarded without a ten-second retry', async () => {
  const host = await fixture(() => {});
  try {
    await host.stop();
    const started = performance.now();
    assert.equal(await host.read(), null);
    assert(performance.now() - started < 500);
    assert.equal(fs.existsSync(host.discovery), false);
  } finally { await host.cleanup(); }
});

test('an unresponsive persistent host keeps its discovery and terminal sessions', async () => {
  const host = await fixture(() => {});
  try {
    await assert.rejects(host.read(), { preserveTerminalHost: true });
    assert.deepEqual(JSON.parse(fs.readFileSync(host.discovery, 'utf8')), host.config);
  } finally { await host.cleanup(); }
});

test('a healthy but incompatible host with active terminals remains protected', async () => {
  const host = await fixture((request, response) => {
    assert.equal(request.headers.authorization, 'Bearer disposable-test-token');
    response.setHeader('Content-Type', 'application/json');
    response.end(request.url === '/api/term' ? JSON.stringify([{ status: 'running' }]) : '{}');
  });
  try {
    fs.writeFileSync(host.discovery, JSON.stringify({ ...host.config, terminalHostVersion: 4 }));
    await assert.rejects(host.read(), { preserveTerminalHost: true });
    assert.equal(JSON.parse(fs.readFileSync(host.discovery, 'utf8')).terminalHostVersion, 4);
  } finally { await host.cleanup(); }
});

test('a healthy compatible host is reused after one health request', async () => {
  let requests = 0;
  const host = await fixture((_request, response) => { requests++; response.end('{}'); });
  try {
    assert.deepEqual(JSON.parse(JSON.stringify(await host.read())), host.config);
    assert.equal(requests, 1);
    assert.equal(fs.existsSync(host.discovery), true);
  } finally { await host.cleanup(); }
});

test('a temporarily busy discovered host recovers without losing discovery', async () => {
  let requests = 0;
  const host = await fixture((_request, response) => {
    requests++;
    response.writeHead(requests < 3 ? 503 : 200).end('{}');
  });
  try {
    assert.deepEqual(JSON.parse(JSON.stringify(await host.read())), host.config);
    assert.equal(requests, 3);
    assert.equal(fs.existsSync(host.discovery), true);
  } finally { await host.cleanup(); }
});

test('a discovered host can recover after one stalled health request', async () => {
  let requests = 0;
  const host = await fixture((_request, response) => {
    requests++;
    if (requests > 1) response.end('{}');
  });
  try {
    assert.deepEqual(JSON.parse(JSON.stringify(await host.read())), host.config);
    assert.equal(requests, 2);
    assert.equal(fs.existsSync(host.discovery), true);
  } finally { await host.cleanup(); }
});

test('a discovered host can recover after a reset health connection', async () => {
  let requests = 0;
  const host = await fixture((request, response) => {
    requests++;
    if (requests === 1) request.socket.destroy();
    else response.end('{}');
  });
  try {
    assert.deepEqual(JSON.parse(JSON.stringify(await host.read())), host.config);
    assert.equal(requests, 2);
    assert.equal(fs.existsSync(host.discovery), true);
  } finally { await host.cleanup(); }
});

for (const active of [true, false]) test(`changed development sources ${active ? 'reuse active terminals' : 'refresh an idle host'}`, async () => {
  const host = await fixture((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(request.url === '/api/term' ? JSON.stringify([{ status: active ? 'running' : 'exited' }]) : '{}');
  }, { isDev: () => true, developmentSidecarStamp: () => 'new-source' });
  try {
    const result = await host.read();
    if (active) {
      assert.deepEqual(JSON.parse(JSON.stringify(result)), host.config);
      assert.deepEqual(JSON.parse(fs.readFileSync(host.discovery, 'utf8')), host.config);
    } else {
      assert.equal(result, null);
      assert.equal(fs.existsSync(host.discovery), false);
    }
  } finally { await host.cleanup(); }
});

test('disabled legacy cloud endpoints do not block reopening active terminals', async () => {
  const host = await fixture((_request, response) => response.end('{}'));
  try {
    const config = { ...host.config, cloudConfiguration: { enabled: false, appBase: '', apiBase: 'https://api.coloride.com' } };
    fs.writeFileSync(host.discovery, JSON.stringify(config));
    assert.deepEqual(JSON.parse(JSON.stringify(await host.read())), config);
  } finally { await host.cleanup(); }
});

test('enabled cloud configuration changes still protect active terminals', async () => {
  const host = await fixture((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(request.url === '/api/term' ? JSON.stringify([{ status: 'running' }]) : '{}');
  }, { cloudConfig: { enabled: true, appBase: 'https://coloride.com', apiBase: 'https://api.coloride.com' } });
  try {
    await assert.rejects(host.read(), { preserveTerminalHost: true });
    assert.equal(fs.existsSync(host.discovery), true);
  } finally { await host.cleanup(); }
});
