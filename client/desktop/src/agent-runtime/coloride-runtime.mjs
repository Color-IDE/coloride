/** Coloride stdio entry point for the agent turn scheduler. */
import { createInterface } from "node:readline";
import { runTurn } from "./turn-loop.mjs";

const controller = new AbortController();
const pending = new Map();
let sequence = 0, started = false, finished = false;
const send = value => { if (!finished) process.stdout.write(`${JSON.stringify(value)}\n`); };
const request = (op, data) => new Promise((resolve, reject) => {
  if (controller.signal.aborted) return reject(new Error(String(controller.signal.reason)));
  const id = ++sequence;
  pending.set(id, { resolve, reject });
  send({ id, op, ...data });
});
const cancel = reason => {
  controller.abort(reason);
  for (const waiter of pending.values()) waiter.reject(new Error(reason));
  pending.clear();
};
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
const finish = result => {
  send({ op: "done", ...result });
  finished = true;
  lines.close();
  process.stdin.pause();
  process.exitCode = result.status === "failed" ? 1 : 0;
};
lines.on("close", () => { if (!finished) cancel("Coloride host disconnected"); });
lines.on("line", line => {
  try {
    const value = JSON.parse(line);
    if (!value || typeof value !== "object") throw new Error("Expected a protocol object");
    if (value.op === "start") {
      if (started) throw new Error("A turn is already running");
      started = true;
      runTurn(value, request, (op, data) => send({ op, ...data }), controller.signal)
        .then(finish, error => finish({ status: controller.signal.aborted ? "cancelled" : "failed", error: error.message }));
    } else if (value.op === "cancel") cancel(value.reason || "Cancelled by user");
    else {
      const waiter = pending.get(value.id);
      if (!waiter) return;
      pending.delete(value.id);
      if (value.error) waiter.reject(new Error(value.error));
      else waiter.resolve(value.result ?? {});
    }
  } catch (error) {
    send({ op: "fatal", error: `Invalid host protocol: ${error.message}` });
    cancel(error.message);
  }
});
