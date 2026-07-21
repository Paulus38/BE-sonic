import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

export interface JwtPayload {
  sub: string;
  email: string;
}

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
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }
    const valid = await this.usersService.validatePassword(user, dto.password);
    if (!valid) {
      throw new UnauthorizedException('Invalid email or password');
    }
    return this.buildAuthResponse(user.id, user.email, user);
  }

  private buildAuthResponse(
    userId: string,
    email: string,
    user: Awaited<ReturnType<UsersService['findByIdOrFail']>>,
  ) {
    const payload: JwtPayload = { sub: userId, email };
    const accessToken = this.jwtService.sign(payload);
    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: this.config.get<string>('app.jwtExpiresIn'),
      user: this.usersService.toPublic(user),
    };
  }
}
