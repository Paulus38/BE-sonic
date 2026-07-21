import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { User } from './user.entity';
import { StorageService } from '../storage/storage.service';

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
}
