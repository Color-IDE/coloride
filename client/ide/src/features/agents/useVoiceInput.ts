import { useCallback, useEffect, useRef, useState } from "react";
import { voiceTranscript, type VoiceSnapshot } from "./voiceTranscript";
import { useAgentErrorNotification } from "./useAgentErrorNotification";

const startSound = new URL("../../../../desktop/resources/clasp.wav", import.meta.url).href;
const stopSound = new URL("../../../../desktop/resources/unclasp.wav", import.meta.url).href;

const cues = new Map<string, HTMLAudioElement>();
function prepareCue(url: string) {
  let audio = cues.get(url);
  if (!audio) {
    audio = new Audio(url);
    audio.preload = "auto";
    audio.volume = 0.25;
    audio.load();
    cues.set(url, audio);
  }
  return audio;
}

function playCue(url: string) {
  const audio = prepareCue(url);
  audio.currentTime = 0;
  void audio.play().catch(() => {});
}

const MAX_BUFFERED_AUDIO = 16000 * 2 * 60;

type Capture = {
  id: string;
  scope: string;
  flushed: boolean;
  eofSent: boolean;
  ready: boolean;
  frames: ArrayBuffer[];
  queuedBytes: number;
  cancelled: boolean;
  stopping: boolean;
  stream?: MediaStream;
  context?: AudioContext;
  node?: AudioWorkletNode;
  socket?: WebSocket;
  timer?: ReturnType<typeof setTimeout>;
  recordingTimer?: ReturnType<typeof setTimeout>;
  drainTimer?: ReturnType<typeof setTimeout>;
  flushTimer?: ReturnType<typeof setTimeout>;
};

/** Each capture owns its resources and draft, including during model startup. */
export function useVoiceInput(scope: string, disabled: boolean, getText: () => string, writeText: (text: string) => void) {
  const [state, setState] = useState<"idle" | "starting" | "recording" | "stopping">("idle");
  const [error, setError] = useAgentErrorNotification({ title: "Voice input" });
  useEffect(() => {
    prepareCue(startSound);
    prepareCue(stopSound);
  }, []);
  const active = useRef<Capture | null>(null);
  const callbacks = useRef({ getText, writeText, scope, disabled });
  callbacks.current = { getText, writeText, scope, disabled };

  const dispose = useCallback((capture: Capture) => {
    capture.cancelled = true;
    clearTimeout(capture.timer);
    clearTimeout(capture.flushTimer);
    clearTimeout(capture.recordingTimer);
    clearTimeout(capture.drainTimer);
    capture.frames = [];
    capture.queuedBytes = 0;
    capture.stream?.getTracks().forEach(track => track.stop());
    capture.node?.disconnect();
    void capture.context?.close().catch(() => {});
    capture.socket?.close();
    void window.colorideDesktop?.dictation?.stop(capture.id, true).catch(() => {});
    if (active.current === capture) active.current = null;
  }, []);

  const finish = useCallback((capture: Capture, message = "") => {
    if (active.current !== capture) return;
    dispose(capture);
    setState("idle");
    if (message) setError(message);
  }, [dispose]);

  const pump = useCallback((capture: Capture): void => {
    if (capture.cancelled || !capture.ready || capture.socket?.readyState !== WebSocket.OPEN) return;
    clearTimeout(capture.drainTimer);
    // Pace the startup backlog without starving live microphone frames.
    while (capture.frames.length && capture.socket.bufferedAmount < 128_000) {
      const frame = capture.frames.shift()!;
      capture.queuedBytes -= frame.byteLength;
      capture.socket.send(frame);
    }
    if (capture.frames.length) {
      capture.drainTimer = setTimeout(() => pump(capture), 20);
    } else if (capture.stopping && capture.flushed && !capture.eofSent) {
      capture.eofSent = true;
      // WebSocket preserves ordering: EOF follows every recorded frame.
      capture.socket.send(new ArrayBuffer(0));
      capture.timer = setTimeout(() => finish(capture, "Transcription took too long. The text received so far is preserved."), 45_000);
    }
  }, [finish]);

  const stop = useCallback((capture: Capture) => {
    if (capture.stopping || capture.cancelled) return;
    capture.stopping = true;
    playCue(stopSound);
    setState("stopping");
    clearTimeout(capture.recordingTimer);
    capture.stream?.getTracks().forEach(track => track.stop());
    if (!capture.node) { finish(capture); return; }
    // Keep the engine startup alive: stopping capture still submits its audio.
    capture.node.port.postMessage("flush");
    capture.flushTimer = setTimeout(() => {
      capture.flushed = true;
      capture.node?.disconnect();
      void capture.context?.close().catch(() => {});
      pump(capture);
    }, 1000);
  }, [finish, pump]);

  useEffect(() => {
    setState("idle");
    setError("");
    return () => { if (active.current) dispose(active.current); };
  }, [scope, disabled, dispose]);

  const toggle = useCallback(async () => {
    if (active.current) { stop(active.current); return; }
    if (disabled) return;
    const bridge = window.colorideDesktop?.dictation;
    if (!bridge) { setError("Voice input requires the desktop app."); return; }
    const capture: Capture = { id: crypto.randomUUID(), scope, cancelled: false, stopping: false, flushed: false, eofSent: false, ready: false, frames: [], queuedBytes: 0 };
    active.current = capture;
    playCue(startSound);
    const base = callbacks.current.getText();
    const prefix = `${base}${base && !/\s$/.test(base) ? " " : ""}`;
    setError("");
    setState("starting");
    // Start loading in parallel, but capture audio before waiting for the model.
    // Settle failures immediately so permission denial cannot leave an unhandled promise.
    const startup = bridge.start(capture.id, "auto").then(
      result => ({ result, error: null }),
      error => ({ result: null, error }),
    );
    capture.timer = setTimeout(() => finish(capture, "Voice model startup took too long. Try again."), 180_000);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
      capture.stream = stream;
      if (capture.cancelled) { stream.getTracks().forEach(track => track.stop()); return; }
      const context = new AudioContext({ sampleRate: 16000 });
      capture.context = context;
      if (context.sampleRate !== 16000) throw new Error("This audio device cannot capture at 16 kHz.");
      await context.audioWorklet.addModule(new URL("assets/voice-pcm.js", document.baseURI).href);
      if (capture.cancelled) return;
      const node = new AudioWorkletNode(context, "voice-pcm");
      capture.node = node;
      node.port.onmessage = ({ data }) => {
        if (capture.cancelled) return;
        if (data === "flushed") {
          clearTimeout(capture.flushTimer);
          capture.flushed = true;
          node.disconnect();
          void context.close().catch(() => {});
        } else if (data instanceof ArrayBuffer) {
          if (capture.queuedBytes + data.byteLength > MAX_BUFFERED_AUDIO) {
            finish(capture, "Voice recognition cannot keep up. Try a shorter recording.");
            return;
          }
          capture.frames.push(data);
          capture.queuedBytes += data.byteLength;
        }
        pump(capture);
      };
      const source = context.createMediaStreamSource(stream);
      const mute = context.createGain();
      mute.gain.value = 0;
      source.connect(node).connect(mute).connect(context.destination);
      await context.resume();
      if (capture.cancelled) return;
      if (!capture.stopping) capture.recordingTimer = setTimeout(() => stop(capture), 60_000);
      const settled = await startup;
      if (capture.cancelled) return;
      if (settled.error) throw settled.error;
      if (!settled.result || settled.result.cancelled) throw new Error("Dictation was cancelled before the voice model became ready.");
      const endpoint = new URL(settled.result.url);
      if (endpoint.protocol !== "ws:" || endpoint.hostname !== "127.0.0.1") throw new Error("Voice input must use a local server.");
      endpoint.searchParams.set("language", "auto");
      clearTimeout(capture.timer);
      const socket = new WebSocket(endpoint.href);
      capture.socket = socket;
      capture.timer = setTimeout(() => finish(capture, "Could not connect to local voice recognition."), 15_000);
      socket.onerror = () => finish(capture, "Connection to local voice recognition failed.");
      socket.onclose = () => { if (!capture.cancelled) finish(capture, "Voice connection closed before transcription finished."); };
      let snapshot: VoiceSnapshot | null = null;
      socket.onmessage = async ({ data }) => {
        if (capture.cancelled || callbacks.current.scope !== capture.scope || callbacks.current.disabled) return;
        try {
          const result = JSON.parse(String(data));
          if (result.error || result.type === "error") throw new Error(result.error || result.message || "Transcription failed.");
          if (result.type === "ready_to_stop") {
            const finalText = snapshot ? voiceTranscript(snapshot, true) : "";
            if (finalText) callbacks.current.writeText(prefix + finalText);
            finish(capture);
            return;
          }
          if (Array.isArray(result.lines) || typeof result.buffer_transcription === "string") {
            snapshot = result;
            const text = voiceTranscript(result);
            if (text) callbacks.current.writeText(prefix + text);
          }
          if (result.type !== "config") return;
          if (!result.useAudioWorklet) throw new Error("Voice server must accept PCM audio.");
          clearTimeout(capture.timer);
          capture.ready = true;
          if (!capture.stopping) setState("recording");
          pump(capture);
        } catch (reason) { finish(capture, reason instanceof Error ? reason.message : "Invalid voice response."); }
      };
    } catch (reason) {
      if (!capture.cancelled) finish(capture, reason instanceof Error ? reason.message.replace(/^Error invoking remote method '[^']+': Error: /, "") : "Could not start voice input.");
    }
  }, [disabled, finish, pump, scope, stop]);

  return { state, error, toggle };
}
