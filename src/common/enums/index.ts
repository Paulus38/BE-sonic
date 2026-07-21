export enum RecordingCategory {
  MEETING = 'Cuộc họp',
  INTERVIEW = 'Phỏng vấn',
  ENGLISH = 'Học Tiếng Anh',
}

export enum RecordingStatus {
  RECORDING = 'recording',
  PROCESSING = 'processing',
  READY = 'ready',
  FAILED = 'failed',
}

export enum SpeechProviderType {
  GEMINI = 'gemini',
  DEEPGRAM = 'deepgram',
}

/** System RBAC roles */
export enum UserRole {
  USER = 'user',
  ADMIN = 'admin',
}

export type AiFeature = 'summarize' | 'translate' | 'transcribe';
