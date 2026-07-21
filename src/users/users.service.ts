import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { ConfigService } from '@nestjs/config';
import { UsersRepository } from './users.repository';
import { User } from './user.entity';
import { UpdateSettingsDto } from './dto/update-settings.dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly config: ConfigService,
  ) {}

  async createUser(
    name: string,
    email: string,
    password: string,
  ): Promise<User> {
    const existing = await this.usersRepository.findByEmail(email);
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const rounds = this.config.get<number>('app.bcryptRounds') ?? 12;
    const passwordHash = await bcrypt.hash(password, rounds);
    const user = this.usersRepository.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      passwordHash,
      avatar: null,
    });
    return this.usersRepository.save(user);
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findByEmail(email);
  }

  async findByIdOrFail(id: string): Promise<User> {
    const user = await this.usersRepository.findById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async validatePassword(user: User, password: string): Promise<boolean> {
    return bcrypt.compare(password, user.passwordHash);
  }

  toPublic(user: User) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      avatar: user.avatar,
      primaryLang: user.primaryLang,
      secondaryLang: user.secondaryLang,
      sampleRate: user.sampleRate,
      aiNoiseCancellation: user.aiNoiseCancellation,
      theme: user.theme,
    };
  }

  async updateSettings(userId: string, dto: UpdateSettingsDto) {
    const user = await this.findByIdOrFail(userId);
    if (dto.name !== undefined) user.name = dto.name.trim();
    if (dto.avatar !== undefined) user.avatar = dto.avatar;
    if (dto.primaryLang !== undefined) user.primaryLang = dto.primaryLang;
    if (dto.secondaryLang !== undefined) user.secondaryLang = dto.secondaryLang;
    if (dto.sampleRate !== undefined) user.sampleRate = dto.sampleRate;
    if (dto.aiNoiseCancellation !== undefined) {
      user.aiNoiseCancellation = dto.aiNoiseCancellation;
    }
    if (dto.theme !== undefined) user.theme = dto.theme;
    const saved = await this.usersRepository.save(user);
    return this.toPublic(saved);
  }
}
