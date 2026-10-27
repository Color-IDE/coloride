import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  filterAgentPlugins,
  filterSlashCommands,
  findAgentPlugin,
  findSlashCommand,
  parseSlashInput,
  rememberSlashCommand,
  splitPluginCommand,
  splitSlashCommands,
} from "../../../src/features/agents/slashCommands";

describe("parseSlashInput", () => {
  it("parses a bare command", () => {
    const parsed = parseSlashInput("/plan");
    assert.deepEqual(parsed, { raw: "/plan", name: "plan", args: "" });
  });

  it("parses args and a following prompt", () => {
    const parsed = parseSlashInput("/ask explain auth");
    assert.equal(parsed?.name, "ask");
    assert.equal(parsed?.args, "explain auth");
  });

  it("treats unix paths as not a command", () => {
    assert.equal(parseSlashInput("/var/www/app"), null);
    assert.equal(parseSlashInput("/Users/ilyes/code"), null);
  });

  it("ignores plain text", () => {
    assert.equal(parseSlashInput("plan this"), null);
  });
});

describe("filterSlashCommands", () => {
  it("filters by prefix", () => {
    const names = filterSlashCommands("pl").map((command) => command.name);
    assert.ok(names.includes("plan"));
    assert.ok(names.includes("add-plugin"));
  });

  it("resolves exact commands", () => {
    assert.equal(findSlashCommand("run-everything")?.id, "run-everything");
    assert.equal(findSlashCommand("log")?.id, "log");
  });

  it("does not include model", () => {
    assert.equal(findSlashCommand("model"), undefined);
  });

  it("hides ask plan and debug until typed", () => {
    const idle = filterSlashCommands("").map((command) => command.id);
    assert.ok(!idle.includes("ask"));
    assert.ok(!idle.includes("plan"));
    assert.ok(!idle.includes("debug"));
    assert.ok(filterSlashCommands("as").some((command) => command.id === "ask"));
    assert.ok(filterSlashCommands("pl").some((command) => command.id === "plan"));
  });
});

describe("agent plugins", () => {
  it("resolves unique prefixes", () => {
    assert.equal(findAgentPlugin("lin")?.id, "linear");
    assert.equal(findAgentPlugin("GitHub")?.id, "github");
    assert.equal(findAgentPlugin("xyz"), undefined);
  });

  it("filters plugin names", () => {
    const names = filterAgentPlugins("issue").map((plugin) => plugin.id);
    assert.ok(names.includes("linear"));
    assert.ok(names.includes("github"));
  });

  it("does not send the command — splits plugin and remainder", () => {
    const split = splitPluginCommand("/add-plugin Linear look at ENG-1");
    assert.equal(split?.mode, "add");
    assert.equal(split?.plugin?.id, "linear");
    assert.equal(split?.remainder, "look at ENG-1");
    const bare = splitPluginCommand("/add-plugin Linear");
    assert.equal(bare?.remainder, "");
  });
});

describe("recent slash commands", () => {
  it("keeps the latest five, newest first", () => {
    const store = new Map<string, string>();
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
      },
    });
    try {
      rememberSlashCommand("plan");
      rememberSlashCommand("ask");
      rememberSlashCommand("fork");
      rememberSlashCommand("shell");
      rememberSlashCommand("canvas");
      rememberSlashCommand("summarize");
      rememberSlashCommand("ask");
      const { recent } = splitSlashCommands(filterSlashCommands(""));
      assert.deepEqual(
        recent.map((command) => command.id),
        ["ask", "summarize", "canvas", "shell", "fork"],
      );
    } finally {
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: original });
    }
  });
});
