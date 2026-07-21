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
import { Server, Socket } from 'socket.io';
import { LiveService } from './live.service';
import { User } from '../users/user.entity';

interface AuthedSocket extends Socket {
  data: { user?: User };
}

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

  @WebSocketServer()
  server!: Server;

  constructor(private readonly liveService: LiveService) {}

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
  }

  @SubscribeMessage('session.start')
  async onStart(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody()
    body: {
      recordingId?: string;
      category?: string;
      mode?: 'browser' | 'server';
    },
  ) {
    const user = client.data.user;
    if (!user || !body?.recordingId) {
      return { ok: false, message: 'Invalid start payload' };
    }

    const category = (body.category ?? 'Học Tiếng Anh').slice(0, 64);
    const mode = body.mode === 'server' ? 'server' : 'browser';

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
    try {
      await this.liveService.ingestUtterance(
        client.id,
        user,
        body.text,
        !!body.isFinal,
        typeof body.speaker === 'string' ? body.speaker : undefined,
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
    if (!body?.data || typeof body.data !== 'string') {
      return { ok: false };
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
    this.liveService.setPaused(client.id, true);
    return { ok: true };
  }

  @SubscribeMessage('session.resume')
  onResume(@ConnectedSocket() client: AuthedSocket) {
    this.liveService.setPaused(client.id, false);
    return { ok: true };
  }

  @SubscribeMessage('session.stop')
  async onStop(@ConnectedSocket() client: AuthedSocket) {
    await this.liveService.stopSession(client.id);
    return { ok: true };
  }
}
