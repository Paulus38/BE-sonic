import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { UserRole } from '../enums';
import { User } from '../../users/user.entity';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;

    const request = context.switchToHttp().getRequest<{ user?: User }>();
    const user = request.user;
    const role = (user?.role as UserRole) || UserRole.USER;
    if (!required.includes(role)) {
      throw new ForbiddenException(
        `Yêu cầu quyền: ${required.join(' | ')}. Vai trò hiện tại: ${role}`,
      );
    }
    return true;
  }
}
