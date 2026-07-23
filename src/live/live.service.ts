import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { SpeechService } from '../speech/speech.service';
import { AiService } from '../ai/ai.service';
import { RecordingsService } from '../recordings/recordings.service';
import { UsersService } from '../users/users.service';
import { SpeechSession } from '../speech/providers/speech-provider.interface';
import { JwtPayload } from '../auth/auth.service';
import { User } from '../users/user.entity';

export type TranscriptCallback = (event: {
  type: 'partial' | 'final' | 'translation';
  text: string;
  translation?: string;
  speaker?: string;
  seq: number;
  tStartMs: number;
  tEndMs: number;
}) => void;

export interface LiveSessionState {
  userId: string;
  recordingId: string;
  category: string;
  /** Spoken language for STT / translation behaviour */
  language: 'en' | 'vi';
  speech: SpeechSession | null;
  seq: number;
  startedAt: number;
  paused: boolean;
  mode: 'browser' | 'server';
  onTranscript: TranscriptCallback;
}

@Injectable()
export class LiveService {
  private readonly logger = new Logger(LiveService.name);
  private readonly sessions = new Map<string, LiveSessionState>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly speechService: SpeechService,
    private readonly aiService: AiService,
    private readonly recordingsService: RecordingsService,
    private readonly usersService: UsersService,
  ) {}

  async authenticateSocket(token?: string): Promise<User> {
    if (!token) {
      throw new Error('Missing auth token');
    }
    const secret = this.config.get<string>('app.jwtSecret');
    const payload = this.jwtService.verify<JwtPayload>(token, { secret });
    return this.usersService.findByIdOrFail(payload.sub);
  }

  async startSession(
    clientId: string,
    user: User,
    recordingId: string,
    category: string,
    mode: 'browser' | 'server',
    onTranscript: TranscriptCallback,
    language: 'en' | 'vi' = 'en',
  ): Promise<{ mode: 'browser' | 'server'; provider: string; language: 'en' | 'vi' }> {
    await this.recordingsService.getOne(user.id, recordingId);

    let speech: SpeechSession | null = null;
    if (mode === 'server') {
      speech = this.speechService.createSession({
        category,
        language: language === 'vi' ? 'vi' : 'en',
        userId: user.id,
      });
    }

    const state: LiveSessionState = {
      userId: user.id,
      recordingId,
      category,
      language,
      speech,
      seq: 0,
      startedAt: Date.now(),
      paused: false,
      mode,
      onTranscript,
    };
    this.sessions.set(clientId, state);

    if (speech) {
      await speech.start(async (result) => {
        if (state.paused || !result.text.trim()) return;
        if (!result.isFinal) {
          const now = Date.now() - state.startedAt;
          onTranscript({
            type: 'partial',
            text: result.text,
            seq: state.seq,
            tStartMs: Math.max(0, now - 1500),
            tEndMs: now,
          });
          return;
        }
        await this.commitFinal(state, user, result.text, 'Speaker');
      });
    }

    return {
      mode,
      language,
      provider:
        mode === 'browser' ? 'web-speech' : this.speechService.getProviderName(),
    };
  }

  async ingestUtterance(
    clientId: string,
    user: User,
    text: string,
    isFinal: boolean,
    speaker?: string,
    clientSeq?: number,
  ): Promise<void> {
    const state = this.sessions.get(clientId);
    if (!state || state.paused) return;
    if (state.userId !== user.id) {
      throw new Error('Session user mismatch');
    }

    const cleaned = text.trim().slice(0, 2000);
    if (!cleaned) return;

    const now = Date.now() - state.startedAt;
    if (!isFinal) {
      state.onTranscript({
        type: 'partial',
        text: cleaned,
        speaker: speaker?.slice(0, 80),
        seq: typeof clientSeq === 'number' ? clientSeq : state.seq,
        tStartMs: Math.max(0, now - 800),
        tEndMs: now,
      });
      return;
    }

    await this.commitFinal(
      state,
      user,
      cleaned,
      (speaker || 'Speaker').slice(0, 80),
      clientSeq,
    );
  }

  private async commitFinal(
    state: LiveSessionState,
    user: User,
    text: string,
    speaker: string,
    clientSeq?: number,
  ): Promise<void> {
    const now = Date.now() - state.startedAt;
    const seq =
      typeof clientSeq === 'number' && Number.isFinite(clientSeq)
        ? clientSeq
        : state.seq++;
    if (typeof clientSeq === 'number' && Number.isFinite(clientSeq)) {
      state.seq = Math.max(state.seq, clientSeq + 1);
    }
    const tStartMs = Math.max(0, now - 2000);
    const tEndMs = now;

    // 1) Emit transcript immediately — do not wait for translation
    state.onTranscript({
      type: 'final',
      text,
      speaker,
      seq,
      tStartMs,
      tEndMs,
    });

    // Skip mid-session DB writes — FE keeps lines; finalize writes after audio OK.

    // 2) Only translate EN → VI when recording language is English
    if (state.language !== 'en') {
      return;
    }

    void this.aiService
      .translateLive(text, user.id)
      .then((translation) => {
        if (!translation) {
          this.logger.warn(`No Vietnamese translation for: ${text.slice(0, 80)}`);
          return;
        }
        state.onTranscript({
          type: 'translation',
          text,
          translation,
          speaker,
          seq,
          tStartMs,
          tEndMs,
        });
      })
      .catch((err) => {
        this.logger.warn(
          `Translate failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  }

  async pushAudio(
    clientId: string,
    chunkBase64: string,
    mimeType: string,
  ): Promise<void> {
    const state = this.sessions.get(clientId);
    if (!state || state.paused || !state.speech) return;
    const buffer = Buffer.from(chunkBase64, 'base64');
    if (buffer.length > 512 * 1024) {
      throw new Error('Audio chunk too large');
    }
    await state.speech.sendAudio(buffer, mimeType);
  }

  setPaused(clientId: string, paused: boolean): void {
    const state = this.sessions.get(clientId);
    if (state) state.paused = paused;
  }

  async stopSession(clientId: string): Promise<void> {
    const state = this.sessions.get(clientId);
    if (!state) return;
    try {
      await state.speech?.stop();
    } finally {
      this.sessions.delete(clientId);
    }
  }
}
