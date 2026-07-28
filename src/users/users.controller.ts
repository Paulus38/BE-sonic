import {
  BadRequestException,
  Controller,
  Get,
  Patch,
  Post,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { RegisterPushTokenDto } from './dto/register-push-token.dto';
import { User } from './user.entity';
import { StorageService } from '../storage/storage.service';
import { MulterFile } from '../common/types/uploaded-file';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/v1/users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly storageService: StorageService,
  ) {}

  @Get('me')
  getMe(@CurrentUser() user: User) {
    return this.usersService.toPublic(user);
  }

  @Get('me/storage')
  getStorage(@CurrentUser() user: User) {
    return this.storageService.getUserUsage(user.id);
  }

  @Patch('me/settings')
  updateSettings(
    @CurrentUser() user: User,
    @Body() dto: UpdateSettingsDto,
  ) {
    return this.usersService.updateSettings(user.id, dto);
  }

  /** App mobile gọi sau khi đăng ký FCM để nhận push notification. */
  @Post('me/push-token')
  registerPushToken(
    @CurrentUser() user: User,
    @Body() dto: RegisterPushTokenDto,
  ) {
    return this.usersService.setPushToken(user.id, dto.token);
  }

  /** Upload ảnh từ điện thoại/máy tính (camera hoặc thư viện) làm avatar. */
  @Post('me/avatar')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 8 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
          cb(null, true);
          return;
        }
        cb(
          new BadRequestException(
            `Định dạng ảnh không hỗ trợ (${file.mimetype || 'unknown'}).`,
          ),
          false,
        );
      },
    }),
  )
  async uploadAvatar(
    @CurrentUser() user: User,
    @UploadedFile() file: MulterFile,
  ) {
    const stored = await this.storageService.saveImage(user.id, file);
    const avatarUrl = stored.publicUrl || stored.key;
    return this.usersService.updateSettings(user.id, { avatar: avatarUrl });
  }
}
