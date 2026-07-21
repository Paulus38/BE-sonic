export interface TranscriptResult {
  text: string;
  isFinal: boolean;
  confidence?: number;
}

export interface SpeechSession {
  start(onResult: (result: TranscriptResult) => void): Promise<void>;
  sendAudio(chunk: Buffer, mimeType: string): Promise<void>;
  stop(): Promise<void>;
}

export interface SpeechProvider {
  readonly name: string;
  createSession(options: {
    language?: string;
    category?: string;
  }): SpeechSession;
}
