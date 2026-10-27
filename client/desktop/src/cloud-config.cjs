const defaults = require("./cloud-config.json");

function endpoint(value, name) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} must be an HTTPS URL without credentials, query or fragment.`);
  }
  return url.href.replace(/\/+$/, "");
}

function resolveCloudConfig(env = process.env) {
  const raw = env.COLORIDE_CLOUD_ENABLED;
  const enabled = raw === undefined ? defaults.enabled : !["0", "false", "no", "off"].includes(raw.trim().toLowerCase());
  return Object.freeze({
    enabled,
    appBase: endpoint(env.COLORIDE_CLOUD_APP_BASE || defaults.appBase, "COLORIDE_CLOUD_APP_BASE"),
    apiBase: endpoint(env.COLORIDE_CLOUD_AUTH_BASE || env.COLORIDE_CLOUD_API_BASE || defaults.apiBase, "COLORIDE_CLOUD_AUTH_BASE"),
  });
}

module.exports = { resolveCloudConfig };
