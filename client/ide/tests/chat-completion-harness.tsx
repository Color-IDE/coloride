import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AgentProviderAvailability, AgentTaskOutcome, AgentEvent } from "@coloride/contracts";
import { buildAgentTimeline, type AgentTimelineEntry } from "../src/features/agents/AgentTimeline";
import { FileTree } from "../src/features/explorer/filetree/FileTree";
import { clearAgentEditReview, queueAgentEditHighlight, reconcileAgentEditReviewDirectory } from "../src/features/editor/agentEditBridge";
import "../src/app/styles.css";

function ChatCompletionHarness() {
  // 1. Provider availability & placeholder
  const [availability, setAvailability] = useState<AgentProviderAvailability>("available");
  const [providerReady, setProviderReady] = useState(true);
  const [activeMode, setActiveMode] = useState<"act" | "ask" | "plan">("act");
  const [errorMessage, setErrorMessage] = useState("");
  const [inputVal, setInputVal] = useState("");

  const placeholder = !providerReady
    ? availability === "loading"
      ? "Checking model availability…"
      : availability === "missing_credentials"
        ? "Configure API key to start"
        : availability === "auth_expired"
          ? "Sign in to resume agent"
          : availability === "incompatible"
            ? "Model does not support tools for Act mode"
            : availability === "connection_error"
              ? "Connection error — verify provider"
              : "Model unavailable"
    : "Ask Coloride to build, inspect, or fix something";

  const handleAvailabilityChange = (next: AgentProviderAvailability) => {
    setAvailability(next);
    setProviderReady(next === "available");
    setErrorMessage("");
  };

  const handleSubmit = () => {
    if (!providerReady) {
      switch (availability) {
        case "loading":
          setErrorMessage("Checking model availability. Please wait a moment...");
          break;
        case "auth_expired":
          setErrorMessage("Your Coloride session has expired. Sign in again to refresh your credentials.");
          break;
        case "missing_credentials":
          setErrorMessage("Configure an OpenAI API key for Coloride Agent before starting a task.");
          break;
        case "incompatible":
          setErrorMessage("Selected model does not support tools for autonomous implementation. Switch to Ask/Plan or select a compatible model.");
          break;
        case "connection_error":
          setErrorMessage("Could not connect to OpenAI. Check your internet connection and credentials.");
          break;
        default:
          setErrorMessage("The selected model is currently unavailable. Please verify your configuration.");
          break;
      }
      return;
    }
    setErrorMessage("");
  };

  // 2. Configuration renewal race prevention simulation
  const configSeqRef = useRef(0);
  const [currentModel, setCurrentModel] = useState("initial-model");

  const simulateModelSelectionRace = async () => {
    // User clicks Model A (slow response 150ms)
    const seqA = ++configSeqRef.current;
    setTimeout(() => {
      if (seqA >= configSeqRef.current) {
        setCurrentModel("model-A-late");
      }
    }, 150);

    // Right after (10ms later), user clicks Model B (fast response 30ms)
    setTimeout(() => {
      const seqB = ++configSeqRef.current;
      setTimeout(() => {
        if (seqB >= configSeqRef.current) {
          setCurrentModel("model-B-fast");
        }
      }, 30);
    }, 10);
  };

  // 3. Recovery simulation without duplicates
  const [timelineEvents, setTimelineEvents] = useState<AgentEvent[]>([]);
  const [taskOutcome, setTaskOutcome] = useState<AgentTaskOutcome | null>(null);
  const queuedFollowUpsRef = useRef<string[]>([]);
  const [queuedFollowUps, setQueuedFollowUps] = useState<string[]>([]);
  const [stopped, setStopped] = useState(false);

  const runRecoverySimulation = () => {
    setTimelineEvents([]);
    setTaskOutcome(null);

    const now = new Date().toISOString();
    // Simulate: user turn -> tool write -> empty response -> recovery instruction -> check -> completion
    const events: AgentEvent[] = [
      {
        id: "evt-user",
        sessionId: "sess-1",
        sequence: 1,
        type: "user",
        data: { text: "Fix the bug in src/auth.ts" },
        createdAt: now,
      },
      {
        id: "evt-tool-1",
        sessionId: "sess-1",
        sequence: 2,
        type: "tool_call",
        data: {
          callId: "call-1",
          tool: "write_file",
          arguments: { path: "src/auth.ts", content: "export const auth = true;" },
        },
        createdAt: now,
      },
      // Model returned empty response; engine emits task_recovery
      {
        id: "evt-recovery",
        sessionId: "sess-1",
        sequence: 3,
        type: "task_recovery",
        data: {
          reason: "empty_response",
          attempt: 1,
          message: "Please state your next step or call complete_task after verification.",
        },
        createdAt: now,
      },
      // Model resumes and executes verification
      {
        id: "evt-tool-2",
        sessionId: "sess-1",
        sequence: 4,
        type: "tool_call",
        data: {
          callId: "call-2",
          tool: "execute_command",
          arguments: { command: "npm test" },
        },
        createdAt: now,
      },
      {
        id: "evt-tool-res-2",
        sessionId: "sess-1",
        sequence: 5,
        type: "tool_result",
        data: {
          callId: "call-2",
          exitCode: 0,
          output: "Tests passed: 5/5",
        },
        createdAt: now,
      },
      // Distinct task outcome
      {
        id: "evt-outcome",
        sessionId: "sess-1",
        sequence: 6,
        type: "task_outcome",
        data: {
          outcome: "completed",
          summary: "Auth bug fixed and verified with tests.",
        },
        createdAt: now,
      },
      {
        id: "evt-done",
        sessionId: "sess-1",
        sequence: 7,
        type: "done",
        data: { stopped: false, failed: false },
        createdAt: now,
      },
    ];

    setTimelineEvents(events);
    setTaskOutcome("completed");
  };

  const simulateStop = () => {
    // Queue 2 follow-ups
    queuedFollowUpsRef.current = ["follow-up 1", "follow-up 2"];
    setQueuedFollowUps(["follow-up 1", "follow-up 2"]);

    // User stops
    queuedFollowUpsRef.current = [];
    setQueuedFollowUps([]);
    setStopped(true);
  };

  // 5. Complete task timeline suppression & assistant summary promotion
  const [completeTaskTimeline, setCompleteTaskTimeline] = useState<AgentTimelineEntry[]>([]);

  const simulateCompleteTaskTimeline = (accepted = false) => {
    const now = new Date().toISOString();
    const testEvents: AgentEvent[] = [
      {
        id: "evt-u1",
        sessionId: "sess-2",
        sequence: 1,
        type: "user_message",
        data: { text: "Fix the build issue" },
        createdAt: now,
      },
      {
        id: "evt-t1",
        sessionId: "sess-2",
        sequence: 2,
        type: "tool_call",
        data: {
          callId: "call-w1",
          tool: "write_file",
          arguments: { path: "src/fix.ts", content: "fixed" },
        },
        createdAt: now,
      },
      {
        id: "evt-r1",
        sessionId: "sess-2",
        sequence: 3,
        type: "tool_result",
        data: {
          callId: "call-w1",
          tool: "write_file",
          exitCode: 0,
          output: "File saved",
        },
        createdAt: now,
      },
      {
        id: "evt-ct1",
        sessionId: "sess-2",
        sequence: 4,
        type: "tool_call",
        data: {
          callId: "call-ct1",
          tool: "complete_task",
          arguments: {
            outcome: "completed",
            summary: "Resolved the build issue and verified tests pass clean.",
          },
        },
        createdAt: now,
      },
      {
        id: "evt-ctr1",
        sessionId: "sess-2",
        sequence: 5,
        type: "tool_result",
        data: {
          callId: "call-ct1",
          tool: "complete_task",
          exitCode: 0,
          output: "Task complete",
        },
        createdAt: now,
      },
    ];

    if (accepted) testEvents.push({
      id: "evt-summary", sessionId: "sess-2", sequence: 6, type: "text",
      data: { text: "Resolved the build issue and verified tests pass clean." }, createdAt: now,
    });
    const entries = buildAgentTimeline(testEvents);
    setCompleteTaskTimeline(entries);
  };

  // Deduped count of tool items
  const toolCalls = timelineEvents.filter((e) => e.type === "tool_call");

  return (
    <main style={{ padding: 24, maxWidth: 800, margin: "auto", fontFamily: "sans-serif" }}>
      <h2>Chat Completion & Availability Harness</h2>

      <section style={{ marginBottom: 20, border: "1px solid #ccc", padding: 12 }}>
        <h3>1. Provider Availability</h3>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          {(["available", "loading", "missing_credentials", "auth_expired", "incompatible", "connection_error"] as AgentProviderAvailability[]).map((st) => (
            <button
              key={st}
              data-testid={`btn-avail-${st}`}
              onClick={() => handleAvailabilityChange(st)}
              style={{ fontWeight: availability === st ? "bold" : "normal" }}
            >
              {st}
            </button>
          ))}
        </div>
        <textarea
          data-testid="composer-input"
          placeholder={placeholder}
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          style={{ width: "100%", height: 60 }}
        />
        <div style={{ marginTop: 8 }}>
          <button data-testid="btn-submit" onClick={handleSubmit}>
            Send Message
          </button>
        </div>
        {errorMessage && (
          <div data-testid="error-message" style={{ color: "red", marginTop: 8 }}>
            {errorMessage}
          </div>
        )}
      </section>

      <section style={{ marginBottom: 20, border: "1px solid #ccc", padding: 12 }}>
        <h3>2. Config Selection Race Prevention</h3>
        <button data-testid="btn-race" onClick={simulateModelSelectionRace}>
          Trigger Fast Model Switch
        </button>
        <div style={{ marginTop: 8 }}>
          Active Model: <strong data-testid="active-model">{currentModel}</strong>
        </div>
      </section>

      <section style={{ marginBottom: 20, border: "1px solid #ccc", padding: 12 }}>
        <h3>3. Recovery & Duplicate Prevention</h3>
        <button data-testid="btn-run-recovery" onClick={runRecoverySimulation}>
          Run Recovery Simulation
        </button>
        <div style={{ marginTop: 12 }}>
          <div data-testid="timeline-tool-count">Tool Calls: {toolCalls.length}</div>
          <div data-testid="task-outcome-display">Outcome: {taskOutcome ?? "none"}</div>
          <ul data-testid="events-list">
            {timelineEvents.map((ev) => (
              <li key={ev.id} data-testid={`event-${ev.type}`}>
                {ev.type}: {JSON.stringify(ev.data)}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section style={{ border: "1px solid #ccc", padding: 12, marginBottom: 20 }}>
        <h3>4. Stop & Continuation Prevention</h3>
        <button data-testid="btn-test-stop" onClick={simulateStop}>
          Queue Messages and Stop
        </button>
        <div style={{ marginTop: 8 }}>
          Queued count: <span data-testid="queued-count">{queuedFollowUps.length}</span>
        </div>
        <div style={{ marginTop: 4 }}>
          Stopped status: <span data-testid="stopped-status">{stopped ? "stopped" : "running"}</span>
        </div>
      </section>

      <section style={{ border: "1px solid #ccc", padding: 12 }}>
        <h3>5. Complete Task Suppression & Summary Promotion</h3>
        <button data-testid="btn-test-complete-task" onClick={() => simulateCompleteTaskTimeline(false)}>
          Simulate Complete Task In Timeline
        </button>
        <button data-testid="btn-accept-complete-task" onClick={() => simulateCompleteTaskTimeline(true)}>
          Publish Accepted Summary
        </button>
        <div style={{ marginTop: 8 }}>
          Complete Task Tool Count:{" "}
          <span data-testid="complete-task-tool-count">
            {completeTaskTimeline.filter((e) => e.kind === "tool" && e.tool === "complete_task").length}
          </span>
        </div>
        <div style={{ marginTop: 4 }}>
          Assistant Summary Text:{" "}
          <span data-testid="complete-task-assistant-text">
            {completeTaskTimeline.find((e) => e.kind === "assistant")?.text ?? ""}
          </span>
        </div>
      </section>
      <section data-testid="review-tree" style={{height: 240, display: "flex", flexDirection: "column"}}>
        <button data-testid="review-seed" onClick={() => {
          clearAgentEditReview();
          queueAgentEditHighlight("/project/src/deleted.ts", "old", "new");
        }}>Restore stale review</button>
        <button data-testid="review-refresh" onClick={() => {
          reconcileAgentEditReviewDirectory("/project", ["/project/src"]);
          reconcileAgentEditReviewDirectory("/project/src", ["/project/src/current.ts"]);
        }}>Refresh directory listing</button>
        <button data-testid="review-current" onClick={() => {
          queueAgentEditHighlight("/project/src/current.ts", "old", "new");
          reconcileAgentEditReviewDirectory("/project/src", ["/project/src/current.ts"]);
        }}>Review existing file</button>
        <button data-testid="review-accept" onClick={() => clearAgentEditReview()}>Keep all</button>
        <FileTree connected workspacePath="/project" expandedIds={new Set()} items={[
          {id: "src", path: "/project/src", name: "src", kind: "dir", depth: 0},
          {id: "current", path: "/project/src/current.ts", name: "current.ts", kind: "file", depth: 1},
        ]} />
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<ChatCompletionHarness />);
