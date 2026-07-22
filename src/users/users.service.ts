import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { ConfigService } from '@nestjs/config';
import { UsersRepository } from './users.repository';
import { User } from './user.entity';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { UserRole } from '../common/enums';

@Injectable()
export class UsersService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly config: ConfigService,
  ) {}

  private isAdminEmail(email: string): boolean {
    const list = this.config.get<string[]>('app.adminEmails') ?? [];
    return list.includes(email.toLowerCase().trim());
  }

  async createUser(
    name: string,
    email: string,
    password: string,
    role?: UserRole,
  ): Promise<User> {
    const existing = await this.usersRepository.findByEmail(email);
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const rounds = this.config.get<number>('app.bcryptRounds') ?? 12;
    const passwordHash = await bcrypt.hash(password, rounds);
    const normalized = email.toLowerCase().trim();
    const resolvedRole =
      role ??
      (this.isAdminEmail(normalized) ? UserRole.ADMIN : UserRole.USER);
    const user = this.usersRepository.create({
      name: name.trim(),
      email: normalized,
      passwordHash,
      avatar: null,
      role: resolvedRole,
    });
    return this.usersRepository.save(user);
  }

  async findByEmail(email: string): Promise<User | null> {
    const user = await this.usersRepository.findByEmail(email);
    if (!user) return null;
    return this.ensureAdminBootstrap(user);
  }

  async findByIdOrFail(id: string): Promise<User> {
    const user = await this.usersRepository.findById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return this.ensureAdminBootstrap(user);
  }

  /** One-time role fill for legacy users. Never re-promotes demoted admins. */
  private async ensureAdminBootstrap(user: User): Promise<User> {
    if (user.role) {
      return user;
    }
    user.role = this.isAdminEmail(user.email)
      ? UserRole.ADMIN
      : UserRole.USER;
    return this.usersRepository.save(user);
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
      role: (user.role as UserRole) || UserRole.USER,
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

  async listUsers() {
    const users = await this.usersRepository.listAll();
    return users.map((u) => this.toPublic(u));
  }

  async setRole(targetUserId: string, role: UserRole, actorId: string) {
    if (role !== UserRole.USER && role !== UserRole.ADMIN) {
      throw new BadRequestException('Role không hợp lệ');
    }
    if (targetUserId === actorId && role !== UserRole.ADMIN) {
      throw new BadRequestException('Không thể tự hạ quyền admin của chính mình');
    }
    const user = await this.findByIdOrFail(targetUserId);
    user.role = role;
    const saved = await this.usersRepository.save(user);
    return this.toPublic(saved);
  }

  async adminCreateUser(input: {
    name: string;
    email: string;
    password: string;
    role?: UserRole;
  }) {
    const role = input.role ?? UserRole.USER;
    if (role !== UserRole.USER && role !== UserRole.ADMIN) {
      throw new BadRequestException('Role không hợp lệ');
    }
    const user = await this.createUser(
      input.name,
      input.email,
      input.password,
      role,
    );
    return this.toPublic(user);
  }

  async adminUpdateUser(
    targetUserId: string,
    actorId: string,
    input: {
      name?: string;
      email?: string;
      password?: string;
      role?: UserRole;
    },
  ) {
    const user = await this.findByIdOrFail(targetUserId);

    if (input.name !== undefined) {
      user.name = input.name.trim();
    }

    if (input.email !== undefined) {
      const normalized = input.email.toLowerCase().trim();
      if (normalized !== user.email) {
        const existing = await this.usersRepository.findByEmail(normalized);
        if (existing && existing.id !== user.id) {
          throw new ConflictException('Email đã được dùng bởi tài khoản khác');
        }
        user.email = normalized;
      }
    }

    if (input.password !== undefined && input.password.trim()) {
      if (input.password.length < 8) {
        throw new BadRequestException('Mật khẩu tối thiểu 8 ký tự');
      }
      const rounds = this.config.get<number>('app.bcryptRounds') ?? 12;
      user.passwordHash = await bcrypt.hash(input.password, rounds);
    }

    if (input.role !== undefined) {
      if (input.role !== UserRole.USER && input.role !== UserRole.ADMIN) {
        throw new BadRequestException('Role không hợp lệ');
      }
      if (targetUserId === actorId && input.role !== UserRole.ADMIN) {
        throw new BadRequestException(
          'Không thể tự hạ quyền admin của chính mình',
        );
      }
      user.role = input.role;
    }

    const saved = await this.usersRepository.save(user);
    return this.toPublic(saved);
  }

  async adminDeleteUser(targetUserId: string, actorId: string) {
    if (targetUserId === actorId) {
      throw new BadRequestException('Không thể tự xoá tài khoản đang đăng nhập');
    }
    await this.findByIdOrFail(targetUserId);
    await this.usersRepository.hardDelete(targetUserId);
    return { deleted: true, id: targetUserId };
  }
}
