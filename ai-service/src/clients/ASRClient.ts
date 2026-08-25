import { config } from '../config';

export interface ASRResult {
  transcript: string;
  confidence: number;
  language: string;
}

export class ASRClient {
  private mockMode: boolean;

  constructor() {
    this.mockMode = config.asr?.provider === 'mock' || !config.asr?.apiKey;
  }

  async transcribeAudio(audioBuffer: Buffer): Promise<ASRResult> {
    if (this.mockMode) {
      return this.mockTranscribe(audioBuffer);
    }

    return this.realTranscribe(audioBuffer);
  }

  private async mockTranscribe(audioBuffer: Buffer): Promise<ASRResult> {
    // Mock transcription that returns a sample Vietnamese phrase
    const mockTranscripts = [
      'Xin chào, tôi muốn tìm sách về lập trình',
      'Bạn có thể giúp tôi tìm sách không?',
      'Tôi muốn mượn cuốn sách này',
      'Cảm ơn bạn đã giúp đỡ',
      'Cho tôi xem danh sách sách mới',
    ];

    const randomIndex = Math.floor(Math.random() * mockTranscripts.length);

    return {
      transcript: mockTranscripts[randomIndex],
      confidence: 0.85 + Math.random() * 0.15,
      language: 'vi',
    };
  }

  private async realTranscribe(audioBuffer: Buffer): Promise<ASRResult> {
    // TODO: Implement real ASR integration (Whisper API, NVIDIA NIM ASR)
    // For now, fall back to mock
    return this.mockTranscribe(audioBuffer);
  }
}
