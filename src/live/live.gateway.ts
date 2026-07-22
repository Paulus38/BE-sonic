import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Server, Socket } from 'socket.io';
import { LiveService } from './live.service';
import { User } from '../users/user.entity';

interface AuthedSocket extends Socket {
  data: { user?: User };
}

type RateBucket = { count: number; resetAt: number };

@WebSocketGateway({
  namespace: '/live',
  cors: {
    origin: (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
      .split(',')
      .map((o) => o.trim()),
    credentials: true,
  },
  maxHttpBufferSize: 1e6,
})
export class LiveGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(LiveGateway.name);
  private readonly rateBuckets = new Map<string, RateBucket>();

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly liveService: LiveService,
    private readonly config: ConfigService,
  ) {}

  async handleConnection(client: AuthedSocket): Promise<void> {
    try {
      const token =
        (client.handshake.auth?.token as string | undefined) ||
        (client.handshake.headers.authorization?.replace(/^Bearer\s+/i, '') as
          | string
          | undefined);
      const user = await this.liveService.authenticateSocket(token);
      client.data.user = user;
      client.emit('session.ready', { userId: user.id });
    } catch (err) {
      this.logger.warn(
        `WS auth failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      client.emit('error', { message: 'Unauthorized' });
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: AuthedSocket): Promise<void> {
    await this.liveService.stopSession(client.id);
    for (const key of this.rateBuckets.keys()) {
      if (key.startsWith(`${client.id}:`)) {
        this.rateBuckets.delete(key);
      }
    }
  }

  @SubscribeMessage('session.start')
  async onStart(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody()
    body: {
      recordingId?: string;
      category?: string;
      mode?: 'browser' | 'server';
      language?: 'en' | 'vi';
    },
  ) {
    const user = client.data.user;
    if (!user || !body?.recordingId) {
      return { ok: false, message: 'Invalid start payload' };
    }
    if (
      !this.allow(
        client.id,
        'session.start',
        this.config.get<number>('app.liveSessionStartPerMin') ?? 10,
        60_000,
      )
    ) {
      return { ok: false, message: 'Too many session starts' };
    }

    const category = (body.category ?? 'Học Tiếng Anh').slice(0, 64);
    const mode = body.mode === 'server' ? 'server' : 'browser';
    const language = body.language === 'vi' ? 'vi' : 'en';

    const meta = await this.liveService.startSession(
      client.id,
      user,
      body.recordingId,
      category,
      mode,
      (event) => {
        if (event.type === 'translation') {
          client.emit('transcript.translation', event);
          return;
        }
        client.emit(
          event.type === 'partial' ? 'transcript.partial' : 'transcript.final',
          event,
        );
      },
      language,
    );

    return { ok: true, ...meta };
  }

  /** Browser STT pushes text here as the user speaks */
  @SubscribeMessage('transcript.utterance')
  async onUtterance(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody()
    body: {
      text?: string;
      isFinal?: boolean;
      speaker?: string;
      seq?: number;
    },
  ) {
    const user = client.data.user;
    if (!user || typeof body?.text !== 'string') {
      return { ok: false };
    }
    if (
      !this.allow(
        client.id,
        'utterance',
        this.config.get<number>('app.liveUtterancePerSec') ?? 20,
        1000,
      )
    ) {
      return { ok: false, message: 'Rate limit exceeded' };
    }
    const text = body.text.slice(0, 2000);
    if (!text.trim()) {
      return { ok: false };
    }
    try {
      await this.liveService.ingestUtterance(
        client.id,
        user,
        text,
        !!body.isFinal,
        typeof body.speaker === 'string'
          ? body.speaker.slice(0, 64)
          : undefined,
        typeof body.seq === 'number' ? body.seq : undefined,
      );
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : 'Utterance error',
      };
    }
  }

  @SubscribeMessage('audio.chunk')
  async onAudio(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { data?: string; mimeType?: string },
  ) {
    if (!client.data.user) {
      return { ok: false, message: 'Unauthorized' };
    }
    if (!body?.data || typeof body.data !== 'string') {
      return { ok: false };
    }
    if (
      !this.allow(
        client.id,
        'audio.chunk',
        this.config.get<number>('app.liveAudioChunkPerSec') ?? 40,
        1000,
      )
    ) {
      return { ok: false, message: 'Rate limit exceeded' };
    }
    if (body.data.length > 700_000) {
      return { ok: false, message: 'Chunk too large' };
    }
    try {
      await this.liveService.pushAudio(
        client.id,
        body.data,
        body.mimeType ?? 'audio/webm',
      );
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : 'Audio error',
      };
    }
  }

  @SubscribeMessage('session.pause')
  onPause(@ConnectedSocket() client: AuthedSocket) {
    if (!client.data.user) return { ok: false };
    this.liveService.setPaused(client.id, true);
    return { ok: true };
  }

  @SubscribeMessage('session.resume')
  onResume(@ConnectedSocket() client: AuthedSocket) {
    if (!client.data.user) return { ok: false };
    this.liveService.setPaused(client.id, false);
    return { ok: true };
  }

  @SubscribeMessage('session.stop')
  async onStop(@ConnectedSocket() client: AuthedSocket) {
    if (!client.data.user) return { ok: false };
    await this.liveService.stopSession(client.id);
    return { ok: true };
  }

  private allow(
    clientId: string,
    action: string,
    limit: number,
    windowMs: number,
  ): boolean {
    const key = `${clientId}:${action}`;
    const now = Date.now();
    let bucket = this.rateBuckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      this.rateBuckets.set(key, bucket);
    }
    bucket.count += 1;
    return bucket.count <= Math.max(1, limit);
  }
}
