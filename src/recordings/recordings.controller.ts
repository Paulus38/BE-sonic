import {
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
import { Response } from 'express';
import { RecordingsService } from './recordings.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/user.entity';
import { PaginationDto } from '../common/dto/pagination.dto';
import {
  CreateRecordingDto,
  FinalizeRecordingDto,
} from './dto/recording.dto';
import { StorageService } from '../storage/storage.service';

@ApiTags('recordings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/v1/recordings')
export class RecordingsController {
  constructor(
    private readonly recordingsService: RecordingsService,
    private readonly storageService: StorageService,
  ) {}

  @Post()
  create(@CurrentUser() user: User, @Body() dto: CreateRecordingDto) {
    return this.recordingsService.create(user, dto);
  }

  @Get()
  list(@CurrentUser() user: User, @Query() query: PaginationDto) {
    return this.recordingsService.list(user.id, query.page, query.limit);
  }

  @Get(':id')
  getOne(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.recordingsService.getOne(user.id, id);
  }

  @Post(':id/finalize')
  finalize(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FinalizeRecordingDto,
  ) {
    return this.recordingsService.finalize(user.id, id, dto);
  }

  @Post(':id/summarize')
  summarize(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.recordingsService.regenerateSummary(user.id, id);
  }

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
      limits: { fileSize: 50 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const ok = [
          'audio/webm',
          'audio/wav',
          'audio/mpeg',
          'audio/mp4',
          'audio/ogg',
          'audio/x-wav',
          'video/webm',
        ].includes(file.mimetype);
        cb(ok ? null : new Error('Unsupported audio type'), ok);
      },
    }),
  )
  uploadAudio(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    this.storageService.assertValidAudio(file);
    return this.recordingsService.attachAudio(user.id, id, file);
  }

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

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.recordingsService.remove(user.id, id);
  }
}
