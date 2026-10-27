const assert = require('node:assert/strict');
const http = require('node:http');
const { test } = require('node:test');
const { performance } = require('node:perf_hooks');
const { setTimeout: delay } = require('node:timers/promises');
const { waitForSidecarHealth } = require('../../../client/desktop/src/sidecar-health.cjs');

async function listen(server, port = 0) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  return { host: '127.0.0.1', port: server.address().port, token: 'disposable-test-token' };
}

async function close(server) {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}

async function closedAddress() {
  const server = http.createServer();
  const config = await listen(server);
  await close(server);
  return config;
}

test('an existing host receives an authenticated health request', async () => {
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push({ path: request.url, authorization: request.headers.authorization });
    response.writeHead(200).end('{}');
  });
  const config = await listen(server);
  try {
    await waitForSidecarHealth(config, { retry: false });
    assert.deepEqual(requests, [{ path: '/api/health', authorization: `Bearer ${config.token}` }]);
  } finally { await close(server); }
});

test('a refused discovered listener fails immediately instead of using startup grace', async () => {
  const config = await closedAddress();
  const started = performance.now();
  await assert.rejects(waitForSidecarHealth(config, { failFastOnRefused: true, timeoutMs: 2_000 }), {
    code: 'ECONNREFUSED',
  });
  assert(performance.now() - started < 500, 'A dead discovered host must not consume the startup retry deadline.');
});

test('a new host retains grace to start listening after launch', async () => {
  const config = await closedAddress();
  const server = http.createServer((_request, response) => response.writeHead(200).end('{}'));
  const starting = delay(80).then(() => listen(server, config.port));
  try {
    await waitForSidecarHealth(config, { timeoutMs: 1_000, retryIntervalMs: 10 });
    await starting;
    assert(server.listening);
  } finally {
    await starting;
    await close(server);
  }
});

test('a stalled probe is bounded and closes its connection', async () => {
  let active = 0;
  const server = http.createServer(() => {});
  server.on('connection', socket => {
    active++;
    socket.once('close', () => active--);
  });
  const config = await listen(server);
  try {
    const started = performance.now();
    await assert.rejects(waitForSidecarHealth(config, {
      retry: false, requestTimeoutMs: 40, timeoutMs: 1_000,
    }), { code: 'ETIMEDOUT' });
    assert(performance.now() - started < 500);
    await delay(30);
    assert.equal(active, 0, 'A timed-out probe must release the connection.');
  } finally { await close(server); }
});

test('a timeout followed by recovery retries once and leaves no late requests', async () => {
  let requests = 0;
  let active = 0;
  let peak = 0;
  const server = http.createServer((_request, response) => {
    requests++;
    active++;
    peak = Math.max(peak, active);
    response.once('close', () => active--);
    if (requests > 1) response.writeHead(200).end('{}');
  });
  const config = await listen(server);
  try {
    await waitForSidecarHealth(config, { timeoutMs: 1_000, requestTimeoutMs: 40, retryIntervalMs: 20 });
    await delay(120);
    assert.equal(requests, 2, 'Timeout and socket error must not schedule separate retries.');
    assert.equal(peak, 1, 'Only one health request may be in flight.');
    assert.equal(active, 0);
  } finally { await close(server); }
});

test('an unexpected health status remains distinguishable from a dead listener', async () => {
  const server = http.createServer((_request, response) => response.writeHead(401).end('{}'));
  const config = await listen(server);
  try {
    await assert.rejects(waitForSidecarHealth(config, { retry: false }), {
      code: 'ERR_SIDECAR_HEALTH_STATUS', statusCode: 401,
    });
  } finally { await close(server); }
});

test('fresh-host startup grace has a finite overall deadline', async () => {
  const config = await closedAddress();
  const started = performance.now();
  await assert.rejects(waitForSidecarHealth(config, { timeoutMs: 100, retryIntervalMs: 10 }), {
    code: 'ECONNREFUSED',
  });
  const duration = performance.now() - started;
  assert(duration >= 90, 'Fresh startup should receive its configured grace.');
  assert(duration < 500, 'Retries must stop at the overall deadline.');
});
