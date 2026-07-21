import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '../common/enums';
import { User } from '../users/user.entity';
import { AiUsageService } from './ai-usage.service';
import { UsersService } from '../users/users.service';

@ApiTags('ai')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/v1/ai')
export class AiController {
  constructor(
    private readonly usage: AiUsageService,
    private readonly users: UsersService,
  ) {}

  @Get('usage')
  async myUsage(@CurrentUser() user: User) {
    const [summary, events] = await Promise.all([
      this.usage.getSummary(user.id),
      this.usage.getEvents(user.id, 40),
    ]);
    return { summary, events };
  }

  @Get('usage/all')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  async allUsage() {
    const summaries = await this.usage.listAllSummaries();
    const users = await this.users.listUsers();
    const byId = new Map(users.map((u) => [u.id, u]));
    return {
      items: summaries.map((s) => ({
        ...s,
        email: byId.get(s.userId)?.email ?? null,
        name: byId.get(s.userId)?.name ?? null,
      })),
    };
  }

  @Get('usage/history')
  async history(
    @CurrentUser() user: User,
    @Query('limit') limit?: string,
  ) {
    const n = limit ? Number(limit) : 40;
    return {
      events: await this.usage.getEvents(user.id, Number.isFinite(n) ? n : 40),
    };
  }
}
