const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveCloudConfig } = require('../../../client/desktop/src/cloud-config.cjs');

test('community mode and custom API resolve without official defaults leaking into overrides', () => {
  assert.deepEqual(resolveCloudConfig({ COLORIDE_CLOUD_ENABLED: '0', COLORIDE_CLOUD_APP_BASE: 'https://login.example.test/', COLORIDE_CLOUD_API_BASE: 'https://api.example.test/' }), {
    enabled: false, appBase: 'https://login.example.test', apiBase: 'https://api.example.test',
  });
});
test('reject unsafe endpoints before credentials can be used', () => {
  for (const apiBase of ['http://example.test', 'https://user:password@example.test', 'https://example.test/?token=secret']) {
    assert.throws(() => resolveCloudConfig({ COLORIDE_CLOUD_AUTH_BASE: apiBase }));
  }
});
