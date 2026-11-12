import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { AuditService } from '../audit/audit.service';

export interface JwtPayload {
  sub: string;
  email: string;
  role?: string;
  tokenUse?: 'refresh';
}

const REFRESH_TOKEN_EXPIRES_IN = '15h';

/**
 * Dummy bcrypt hash so missing-user logins still run compare()
 * (mitigates user-enumeration via timing).
 * Hash of a random placeholder — never matches real passwords in practice.
 */
const LOGIN_TIMING_DUMMY_HASH =
  '$2b$12$3sxYI.m3j9JItt2v.sgfBOftX//sTVV6xHrnJ9KmqK2HUap8AFb8O';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  async register(dto: RegisterDto) {
    const user = await this.usersService.createUser(
      dto.name,
      dto.email,
      dto.password,
    );
    void this.audit.record({
      userId: user.id,
      userEmail: user.email,
      action: 'auth.register',
      resource: 'auth',
      resourceId: user.id,
      status: 'ok',
    });
    return this.buildAuthResponse(user.id, user.email, user);
  }

  async login(dto: LoginDto) {
    const user = await this.usersService.findByEmail(dto.email);
    const hash = user?.passwordHash || LOGIN_TIMING_DUMMY_HASH;
    const valid = await bcrypt.compare(dto.password, hash);
    if (!user || !valid) {
      void this.audit.record({
        userId: user?.id ?? null,
        userEmail: dto.email.toLowerCase().trim(),
        action: 'auth.login',
        resource: 'auth',
        status: 'error',
        message: 'Invalid email or password',
      });
      throw new UnauthorizedException('Invalid email or password');
    }
    void this.audit.record({
      userId: user.id,
      userEmail: user.email,
      action: 'auth.login',
      resource: 'auth',
      resourceId: user.id,
      status: 'ok',
    });
    return this.buildAuthResponse(user.id, user.email, user);
  }

  async refresh(refreshToken: string) {
    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(refreshToken, {
        secret: this.getRefreshSecret(),
      });
    } catch {
      throw new UnauthorizedException('Refresh token không hợp lệ hoặc đã hết hạn');
    }

    if (payload.tokenUse !== 'refresh' || !payload.sub) {
      throw new UnauthorizedException('Refresh token không hợp lệ');
    }

    let user: Awaited<ReturnType<UsersService['findByIdOrFail']>>;
    try {
      user = await this.usersService.findByIdOrFail(payload.sub);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw new UnauthorizedException('Tài khoản không còn tồn tại');
      }
      throw error;
    }
    return this.buildAuthResponse(user.id, user.email, user);
  }

  private getRefreshSecret(): string {
    return (
      this.config.get<string>('app.jwtRefreshSecret') ??
      this.config.getOrThrow<string>('app.jwtSecret')
    );
  }

  private buildAuthResponse(
    userId: string,
    email: string,
    user: Awaited<ReturnType<UsersService['findByIdOrFail']>>,
  ) {
    const payload: JwtPayload = {
      sub: userId,
      email,
      role: user.role || 'user',
    };
    const accessToken = this.jwtService.sign(payload);
    const refreshToken = this.jwtService.sign(
      { ...payload, tokenUse: 'refresh' },
      {
        secret: this.getRefreshSecret(),
        expiresIn: REFRESH_TOKEN_EXPIRES_IN,
      },
    );
    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: this.config.get<string>('app.jwtExpiresIn'),
      refreshExpiresIn: REFRESH_TOKEN_EXPIRES_IN,
      user: this.usersService.toPublic(user),
    };
  }
}
