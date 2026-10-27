// AudioContext runs at 16 kHz; browser resampling precedes this worklet.
class VoicePCM extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Int16Array(1600);
    this.offset = 0;
    this.finished = false;
    this.port.onmessage = ({ data }) => {
      if (data === 'flush') {
        if (this.offset) this.port.postMessage(this.samples.slice(0, this.offset).buffer);
        this.finished = true;
        this.port.postMessage('flushed');
      }
    };
  }
  process(inputs) {
    if (this.finished) return false;
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (const sample of input) {
      const value = Math.max(-1, Math.min(1, sample));
      this.samples[this.offset++] = Math.round(value * (value < 0 ? 32768 : 32767));
      if (this.offset === this.samples.length) {
        this.port.postMessage(this.samples.buffer, [this.samples.buffer]);
        this.samples = new Int16Array(1600);
        this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor('voice-pcm', VoicePCM);
