import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

export interface JwtPayload {
  sub: string;
  email: string;
  role?: string;
}

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
  ) {}

  async register(dto: RegisterDto) {
    const user = await this.usersService.createUser(
      dto.name,
      dto.email,
      dto.password,
    );
    return this.buildAuthResponse(user.id, user.email, user);
  }

  async login(dto: LoginDto) {
    const user = await this.usersService.findByEmail(dto.email);
    const hash = user?.passwordHash || LOGIN_TIMING_DUMMY_HASH;
    const valid = await bcrypt.compare(dto.password, hash);
    if (!user || !valid) {
      throw new UnauthorizedException('Invalid email or password');
    }
    return this.buildAuthResponse(user.id, user.email, user);
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
    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: this.config.get<string>('app.jwtExpiresIn'),
      user: this.usersService.toPublic(user),
    };
  }
}
