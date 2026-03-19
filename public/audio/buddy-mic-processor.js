/**
 * buddy-mic-processor.js — AudioWorklet for Gemini Live mic capture.
 * Runs in the audio thread. Accumulates PCM samples and posts
 * Int16Array chunks to the main thread every ~100ms.
 *
 * Place in /public/audio/ so Next.js serves it as a static file.
 */
class BuddyMicProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = [];
    this._samplesPerChunk = 1600; // 100ms at 16kHz
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const samples = input[0];
    for (let i = 0; i < samples.length; i++) {
      this._buffer.push(Math.max(-1, Math.min(1, samples[i])));
    }

    while (this._buffer.length >= this._samplesPerChunk) {
      const chunk = this._buffer.splice(0, this._samplesPerChunk);
      const int16 = new Int16Array(chunk.length);
      for (let i = 0; i < chunk.length; i++) {
        int16[i] = chunk[i] * 32767;
      }
      this.port.postMessage(int16.buffer, [int16.buffer]);
    }

    return true;
  }
}

registerProcessor("buddy-mic-processor", BuddyMicProcessor);
