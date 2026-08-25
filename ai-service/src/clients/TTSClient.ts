import { config } from '../config';

export interface TTSResult {
  audioBase64: string;
  visemes: Array<{ time: number; value: number }>;
  durationMs: number;
}

export class TTSClient {
  private mockMode: boolean;

  constructor() {
    this.mockMode = config.tts?.provider === 'mock' || !config.tts?.apiKey;
  }

  async synthesizeSpeech(text: string): Promise<TTSResult> {
    if (this.mockMode) {
      return this.mockSynthesize(text);
    }

    return this.realSynthesize(text);
  }

  private async mockSynthesize(text: string): Promise<TTSResult> {
    const durationMs = Math.max(500, text.length * 100);
    const visemes = this.generateMockVisemes(text, durationMs);
    const audioBase64 = this.generateMockAudio(durationMs);

    return {
      audioBase64,
      visemes,
      durationMs,
    };
  }

  private async realSynthesize(text: string): Promise<TTSResult> {
    // TODO: Implement real TTS integration (Azure TTS, ElevenLabs, or NVIDIA NIM TTS)
    // For now, fall back to mock
    return this.mockSynthesize(text);
  }

  private generateMockVisemes(text: string, durationMs: number): Array<{ time: number; value: number }> {
    const visemes: Array<{ time: number; value: number }> = [];
    const syllableCount = Math.max(1, Math.ceil(text.length / 3));
    const interval = durationMs / syllableCount;

    for (let i = 0; i < syllableCount; i++) {
      visemes.push({
        time: Math.floor(i * interval),
        value: Math.floor(Math.random() * 10),
      });
    }

    return visemes;
  }

  private generateMockAudio(durationMs: number): string {
    // Generate a simple sine wave as mock audio (WAV format)
    const sampleRate = 22050;
    const numSamples = Math.floor((durationMs / 1000) * sampleRate);
    const buffer = Buffer.alloc(44 + numSamples * 2);

    // WAV header
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + numSamples * 2, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 2, 28);
    buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(numSamples * 2, 40);

    // Generate simple sine wave
    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      const sample = Math.sin(2 * Math.PI * 440 * t) * 0.3;
      buffer.writeInt16LE(Math.floor(sample * 32767), 44 + i * 2);
    }

    return buffer.toString('base64');
  }
}
