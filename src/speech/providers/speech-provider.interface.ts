export interface TranscriptResult {
  text: string;
  isFinal: boolean;
  confidence?: number;
  /** Human-readable label from diarization, e.g. "Speaker 1" */
  speaker?: string;
}

export interface TranscriptSegmentLine {
  text: string;
  speaker: string;
  tStartMs: number;
  tEndMs: number;
}

export interface FileTranscriptResult {
  text: string;
  segments: TranscriptSegmentLine[];
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

/** Deepgram speaker index → display label (1-based). */
export function formatSpeakerLabel(speakerIndex: number): string {
  const n = Number.isFinite(speakerIndex) ? Math.max(0, Math.floor(speakerIndex)) : 0;
  return `Speaker ${n + 1}`;
}
