"use strict";

const http = require("node:http");
const { performance } = require("node:perf_hooks");

function probeSidecarHealth(config, timeoutMs) {
  return new Promise((resolve, reject) => {
    let request;
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Health only needs the status. Close even a response with an unfinished
      // body, and never leave an old request alive while a retry is running.
      request?.destroy();
      if (error) reject(error);
      else resolve();
    };
    // A wall-clock bound also covers connection setup, where ClientRequest's
    // socket inactivity timeout has not necessarily started yet.
    const timer = setTimeout(() => {
      finish(Object.assign(new Error("Sidecar health request timed out."), { code: "ETIMEDOUT" }));
    }, timeoutMs);
    try {
      request = http.request({
        hostname: config.host,
        port: config.port,
        path: "/api/health",
        method: "GET",
        agent: false,
        headers: { Authorization: `Bearer ${config.token}` },
      }, (response) => {
        response.on("error", finish);
        response.resume();
        if (response.statusCode === 200) {
          finish();
        } else {
          finish(Object.assign(new Error(`Sidecar health returned HTTP ${response.statusCode}.`), {
            code: "ERR_SIDECAR_HEALTH_STATUS",
            statusCode: response.statusCode,
          }));
        }
      });
      request.on("error", finish);
      request.end();
    } catch (error) {
      finish(error);
    }
  });
}

/**
 * New hosts receive startup grace. Discovered hosts can fail immediately on a
 * refused listener while retaining grace for temporary load or reset errors.
 * Error codes let callers preserve unresponsive hosts' terminal discovery.
 */
async function waitForSidecarHealth(config, {
  timeoutMs = 10_000,
  requestTimeoutMs = 500,
  retryIntervalMs = 100,
  retry = true,
  failFastOnRefused = false,
} = {}) {
  const deadline = performance.now() + timeoutMs;
  let failure;
  do {
    const remaining = deadline - performance.now();
    if (remaining <= 0) break;
    try {
      await probeSidecarHealth(config, Math.min(requestTimeoutMs, remaining));
      return;
    } catch (error) {
      failure = error;
      if (!retry || (failFastOnRefused && error.code === "ECONNREFUSED")) break;
    }
    const remainingAfterProbe = deadline - performance.now();
    if (remainingAfterProbe <= 0) break;
    await new Promise(resolve => setTimeout(resolve, Math.min(retryIntervalMs, remainingAfterProbe)));
  } while (performance.now() < deadline);

  const error = new Error(`Python sidecar did not become healthy on ${config.host}:${config.port}.`, { cause: failure });
  error.code = failure?.code;
  if (failure?.statusCode !== undefined) error.statusCode = failure.statusCode;
  throw error;
}

module.exports = { waitForSidecarHealth };
