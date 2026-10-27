/** Coloride's host-driven turn scheduler. No provider or filesystem access. */
export async function runTurn(config, request, emit, signal) {
  const catalog = new Map((config.tools ?? []).map(tool => [tool.name, tool]));
  const allowed = new Set(config.allowedTools ?? catalog.keys());
  let failures = 0, rejections = 0, recoveries = 0, retries = 0;
  let completionRequired = Boolean(config.verificationRequired), accepted = false;
  let output = "", stopReason = "", guidance = [], overflowRecovery = false;
  const repetitions = new Map();
  const limit = Number.isInteger(config.maxIterations) && config.maxIterations > 0 ? config.maxIterations : 200;
  const check = () => { if (signal.aborted) throw new Error(String(signal.reason ?? "Cancelled by user")); };
  const update = result => {
    completionRequired = Boolean(result.completionRequired ?? result.verificationRequired ?? completionRequired);
    accepted = Boolean(result.completionAccepted);
  };
  for (let iteration = 1; iteration <= limit; iteration++) {
    check();
    const response = await request("model", { iteration, guidance, overflowRecovery });
    check();
    guidance = [];
    const calls = response.tool_calls ?? [];
    if (response.error || (!response.text?.trim() && !calls.length)) {
      const message = response.error || "Empty model response";
      if (response.error && !response.errorRetryable && response.errorClass !== "context_overflow") {
        return { status: "failed", error: message, iterations: iteration };
      }
      if (++retries > 3) return { status: "failed", error: message, iterations: iteration };
      overflowRecovery = response.errorClass === "context_overflow";
      guidance = ["The previous response failed. Return a valid response or report a concrete blocker."];
      emit("status", { message: `Retrying model response: ${message}` });
      const delay = config.retryDelayMs ?? Math.min(1000 * 2 ** (retries - 1), 8000);
      if (delay) await new Promise((resolve, reject) => {
        const aborted = () => { clearTimeout(timer); reject(new Error(String(signal.reason))); };
        const timer = setTimeout(() => { signal.removeEventListener("abort", aborted); resolve(); }, delay);
        signal.addEventListener("abort", aborted, { once: true });
        if (signal.aborted) aborted();
      });
      continue;
    }
    retries = 0;
    overflowRecovery = false;
    update(response);
    if (response.text) {
      output = response.text;
      if (!response.streamed) emit("text", { text: response.text });
    }
    if (response.reasoning && !response.streamed) emit("reasoning", { text: response.reasoning });
    if (!calls.length) {
      if (completionRequired && !accepted) {
        if (++recoveries > 2) return { status: "failed", error: "Task completion was not verified", iterations: iteration };
        guidance = ["Continue the task and finish with complete_task and successful verification evidence. Report a blocker if unable to proceed."];
        continue;
      }
      if (response.streamComplete === false || ["length", "max_tokens", "error"].includes(response.finishReason)) {
        if (++recoveries > 2) return { status: "failed", error: "Incomplete model response", iterations: iteration };
        guidance = ["The previous response was incomplete. Continue from the existing context."];
        continue;
      }
      return { status: "completed", output, iterations: iteration };
    }
    for (const call of calls) {
      if (call.arguments && typeof call.arguments === "object" && !Array.isArray(call.arguments)) {
        for (const [key, rule] of Object.entries(catalog.get(call.name)?.parameters?.properties ?? {})) {
          if (!Object.hasOwn(call.arguments, key) && Object.hasOwn(rule, "default")) call.arguments[key] = structuredClone(rule.default);
        }
      }
    }
    const ids = new Set();
    if (calls.some(call => !call.call_id || ids.has(call.call_id) || !ids.add(call.call_id))) {
      return { status: "failed", error: "Duplicate or empty tool call IDs", iterations: iteration };
    }
    // Preserve proposal order. Python owns execution policy and authoritative validation.
    const inFlight = new Map();
    for (const [index, call] of calls.entries()) {
      if (!inFlight.has(call.call_id) && catalog.get(call.name)?.executionMode === "parallel") {
        for (const sibling of calls.slice(index)) {
          const descriptor = catalog.get(sibling.name);
          if (descriptor?.executionMode !== "parallel") break;
          if (allowed.has(sibling.name) && !validateArguments(sibling.arguments, descriptor.parameters ?? {}, sibling.invalidArguments)) {
            inFlight.set(sibling.call_id, request("tool", { call: sibling }));
          }
        }
      }
      check();
      const schema = catalog.get(call.name);
      let error = !schema ? `Unknown tool: ${call.name}` : !allowed.has(call.name) ? `${call.name} is unavailable in ${config.mode} mode` : "";
      if (!error) error = validateArguments(call.arguments, schema.parameters ?? {}, call.invalidArguments);
      const key = JSON.stringify([call.name, canonical(call.arguments)]);
      const count = (repetitions.get(key) ?? 0) + 1;
      repetitions.set(key, count);
      if (count >= 8) {
        stopReason = `Stopped repeated calls to ${call.name} without changed arguments.`;
        await Promise.allSettled(inFlight.values());
        return { status: "failed", output, stopReason, iterations: iteration };
      }
      if (count === 4) guidance.push(`Repeated ${call.name} arguments. Use existing results or choose a different action.`);
      const result = error
        ? await request("tool-result", { call, output: error, failed: true, skipped: true })
        : await (inFlight.get(call.call_id) ?? request("tool", { call }));
      check();
      update(result);
      const failed = Boolean(error || result.failed);
      failures = failed ? failures + 1 : 0;
      if (call.name === "complete_task" && failed) rejections++;
      if (result.stopReason) stopReason = String(result.stopReason);
      if (rejections >= 3) stopReason = "Task completion was rejected three times. Paused to avoid repeating verification without progress.";
      if (failures >= 6) stopReason = "Stopped after six consecutive tool failures.";
      if (stopReason) {
        await Promise.allSettled(inFlight.values());
        return { status: "failed", output, stopReason, iterations: iteration };
      }
    }
  }
  return { status: "failed", output, stopReason: "Maximum model iterations reached", iterations: limit };
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

export function validateArguments(value, schema, invalid = false) {
  if (invalid || !value || typeof value !== "object" || Array.isArray(value)) return "Tool arguments must be a valid JSON object";
  const inspect = (item, rule, path) => {
    if (!rule || typeof rule !== "object") return "";
    if (rule.enum && !rule.enum.some(option => JSON.stringify(option) === JSON.stringify(item))) return `Invalid value at ${path}`;
    const types = Array.isArray(rule.type) ? rule.type : rule.type ? [rule.type] : [];
    const matches = type => type === "null" ? item === null : type === "array" ? Array.isArray(item) : type === "object" ? item !== null && typeof item === "object" && !Array.isArray(item) : type === "integer" ? Number.isInteger(item) : type === "number" ? typeof item === "number" && Number.isFinite(item) : typeof item === type;
    if (types.length && !types.some(matches)) return `Invalid type at ${path}`;
    if (item && typeof item === "object" && !Array.isArray(item)) {
      for (const key of rule.required ?? []) if (!Object.hasOwn(item, key) && !(Array.isArray(rule.properties?.[key]?.type) && rule.properties[key].type.includes("null"))) return `Missing required argument ${path}.${key}`;
      for (const [key, child] of Object.entries(item)) {
        if (rule.additionalProperties === false && !Object.hasOwn(rule.properties ?? {}, key)) return `Unexpected argument ${path}.${key}`;
        const error = inspect(child, rule.properties?.[key], `${path}.${key}`);
        if (error) return error;
      }
    }
    if (Array.isArray(item)) for (const [index, child] of item.entries()) {
      const error = inspect(child, rule.items, `${path}[${index}]`);
      if (error) return error;
    }
    return "";
  };
  return inspect(value, schema, "arguments");
}
