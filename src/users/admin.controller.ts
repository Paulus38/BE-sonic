import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '../common/enums';
import { User } from './user.entity';
import { UsersService } from './users.service';
import { UpdateRoleDto } from './dto/update-role.dto';
import {
  AdminCreateUserDto,
  AdminUpdateUserDto,
} from './dto/admin-user.dto';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('api/v1/admin')
export class AdminController {
  constructor(private readonly usersService: UsersService) {}

  @Get('users')
  listUsers() {
    return this.usersService.listUsers();
  }

  @Post('users')
  createUser(@Body() dto: AdminCreateUserDto) {
    return this.usersService.adminCreateUser(dto);
  }

  @Patch('users/:id')
  updateUser(
    @CurrentUser() actor: User,
    @Param('id') id: string,
    @Body() dto: AdminUpdateUserDto,
  ) {
    return this.usersService.adminUpdateUser(id, actor.id, dto);
  }

  @Patch('users/:id/role')
  setRole(
    @CurrentUser() actor: User,
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.usersService.setRole(id, dto.role, actor.id);
  }

  @Delete('users/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteUser(
    @CurrentUser() actor: User,
    @Param('id') id: string,
  ) {
    await this.usersService.adminDeleteUser(id, actor.id);
  }
}
