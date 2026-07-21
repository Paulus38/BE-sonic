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
  /** True when API key / client is configured and usable */
  isReady(): boolean;
  /** Lightweight latency probe in ms; null if probe failed */
  probeLatencyMs?(): Promise<number | null>;
  createSession(options: {
    language?: string;
    category?: string;
    userId?: string;
  }): SpeechSession;
}
