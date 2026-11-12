class LiveMicCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = Math.round(sampleRate / 50);
    this.frame = new Float32Array(this.size);
    this.written = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    for (let offset = 0; offset < channel.length;) {
      const count = Math.min(channel.length - offset, this.size - this.written);
      this.frame.set(channel.subarray(offset, offset + count), this.written);
      this.written += count;
      offset += count;
      if (this.written === this.size) {
        this.port.postMessage(this.frame, [this.frame.buffer]);
        this.frame = new Float32Array(this.size);
        this.written = 0;
      }
    }
    return true;
  }
}
registerProcessor("live-mic-capture", LiveMicCapture);
