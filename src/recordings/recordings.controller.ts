import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiTags,
} from '@nestjs/swagger';
import { Request, Response } from 'express';
import { RecordingsService } from './recordings.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SkipResponseEnvelope } from '../common/decorators/skip-response-envelope.decorator';
import { User } from '../users/user.entity';
import { PaginationDto } from '../common/dto/pagination.dto';
import {
  ConfirmClientAudioDto,
  CreateRecordingDto,
  FinalizeRecordingDto,
  RetranscribeRecordingDto,
} from './dto/recording.dto';
import { MulterFile } from '../common/types/uploaded-file';
import {
  isAllowedAudioMime,
  StorageService,
} from '../storage/storage.service';

/**
 * REST API bản ghi (recording).
 *
 * Luồng lưu sau khi ghi âm (atomic — audio trước, DB meta sau):
 *   1) POST /                    create draft (status=recording)
 *   2a) Client upload lớn (prod Blob):
 *       GET  /:id/audio/upload-info  → pathname + access
 *       POST /:id/audio/client-upload → token (@vercel/blob handleUpload)
 *       browser upload thẳng lên Blob
 *       POST /:id/audio/confirm      → ghi audioPath vào Firestore
 *   2b) Fallback file nhỏ / không Blob:
 *       POST /:id/audio            → multipart qua Nest → Blob/local
 *   3) POST /:id/finalize          → transcript + metadata (cần audioPath)
 *
 * Khác:
 *   GET    /           list thư viện
 *   GET    /:id        chi tiết + transcript
 *   GET    /:id/audio  stream phát lại
 *   POST   /:id/summarize | /:id/transcribe
 *   DELETE /:id        hủy / xóa
 */
@ApiTags('recordings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/v1/recordings')
export class RecordingsController {
  constructor(
    private readonly recordingsService: RecordingsService,
    private readonly storageService: StorageService,
  ) {}

  /** Tạo draft khi bấm Bắt đầu ghi — FE LiveRecordView.startRecording */
  @Post()
  create(@CurrentUser() user: User, @Body() dto: CreateRecordingDto) {
    return this.recordingsService.create(user, dto);
  }

  /** Thư viện bản ghi — FE App.refreshRecordings */
  @Get()
  list(@CurrentUser() user: User, @Query() query: PaginationDto) {
    return this.recordingsService.list(user.id, query.page, query.limit);
  }

  /** Chi tiết 1 bản ghi (+ transcript) — DetailView / FloatingPlayer */
  @Get(':id')
  getOne(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.recordingsService.getOne(user.id, id);
  }

  /**
   * Kết thúc phiên: ghi title/duration/transcript → READY.
   * Bắt buộc đã có audioPath (sau confirm hoặc multipart upload).
   * Caller: LiveRecordView.handleSave (sau uploadAudio thành công).
   */
  @Post(':id/finalize')
  finalize(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FinalizeRecordingDto,
  ) {
    return this.recordingsService.finalize(user.id, id, dto);
  }

  /** Tóm tắt AI on-demand — App / DetailView (không tự chạy lúc save) */
  @Post(':id/summarize')
  summarize(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.recordingsService.regenerateSummary(user.id, id);
  }

  /** STT lại từ file audio đã lưu — App retranscribe */
  @Post(':id/transcribe')
  retranscribe(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RetranscribeRecordingDto,
  ) {
    return this.recordingsService.retranscribe(user.id, id, dto ?? {});
  }

  /**
   * Bước 1 client-upload: trả pathname + access + maxBytes.
   * FE recordingsApi.uploadAudio → luôn gọi trước khi upload Blob.
   * Service: getClientUploadInfo
   */
  @Get(':id/audio/upload-info')
  audioUploadInfo(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('mime') mime?: string,
  ) {
    return this.recordingsService.getClientUploadInfo(user.id, id, mime);
  }

  /**
   * Bước 2 client-upload: handshake token cho @vercel/blob/client `upload()`.
   * Raw JSON (SkipResponseEnvelope) — SDK Blob không hiểu envelope {success,data}.
   * Service: handleClientUploadToken
   * Mục đích: file cuộc họp lớn vượt ~4.5MB giới hạn body Vercel Function.
   */
  @Post(':id/audio/client-upload')
  @SkipResponseEnvelope()
  clientUpload(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    return this.recordingsService.handleClientUploadToken(
      user.id,
      id,
      body,
      req,
    );
  }

  /**
   * Bước 3 client-upload: sau khi browser upload xong, ghi URL Blob vào DB.
   * Service: attachClientAudio
   * Chỉ gắn audioPath — chưa ghi transcript (để finalize làm).
   */
  @Post(':id/audio/confirm')
  confirmClientAudio(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmClientAudioDto,
  ) {
    return this.recordingsService.attachClientAudio(user.id, id, dto);
  }

  /**
   * Fallback upload: multipart qua Nest → StorageService.saveAudio.
   * Chỉ dùng khi Blob chưa cấu hình + file nhỏ (<~4MB trên Vercel).
   * FE gọi khi upload-info.clientUpload === false.
   * Service: attachAudio
   */
  @Post(':id/audio')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 200 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (isAllowedAudioMime(file.mimetype)) {
          cb(null, true);
          return;
        }
        cb(
          new BadRequestException(
            `Định dạng audio không hỗ trợ (${file.mimetype || 'unknown'}). Dùng webm/mp4/wav/ogg/aac.`,
          ),
          false,
        );
      },
    }),
  )
  uploadAudio(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: MulterFile,
  ) {
    this.storageService.assertValidAudio(file);
    return this.recordingsService.attachAudio(user.id, id, file);
  }

  /** Stream audio đã lưu để phát lại — DetailView / FloatingPlayer */
  @Get(':id/audio')
  async streamAudio(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: false }) res: Response,
  ) {
    const audio = await this.recordingsService.getAudioStream(user.id, id);
    res.setHeader('Content-Type', audio.mime || 'audio/webm');
    res.setHeader('Content-Length', audio.buffer.length);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('Content-Disposition', 'inline');
    res.end(audio.buffer);
  }

  /** Xóa bản ghi (+ blob audio) — hủy phiên / xóa trong thư viện */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.recordingsService.remove(user.id, id);
  }
}
