import { Module } from '@nestjs/common';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { AdminController } from './admin.controller';
import { StorageModule } from '../storage/storage.module';
import { RolesGuard } from '../common/guards/roles.guard';

@Module({
  imports: [StorageModule],
  controllers: [UsersController, AdminController],
  providers: [UsersRepository, UsersService, RolesGuard],
  exports: [UsersService, UsersRepository],
})
export class UsersModule {}
