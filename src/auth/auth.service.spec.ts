import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { AuditService } from '../audit/audit.service';
import { UserRole } from '../common/enums';

describe('AuthService', () => {
  const usersService = {
    createUser: jest.fn(),
    findByEmail: jest.fn(),
    findByIdOrFail: jest.fn(),
    toPublic: jest.fn((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
    })),
  };

  const jwtService = {
    sign: jest.fn(() => 'signed.jwt.token'),
    verifyAsync: jest.fn(),
  };

  const config = {
    get: jest.fn((key: string) =>
      key === 'app.jwtExpiresIn'
        ? '2h'
        : key === 'app.jwtRefreshSecret'
          ? 'refresh-secret'
          : undefined,
    ),
    getOrThrow: jest.fn(() => 'jwt-secret'),
  };

  const audit = {
    record: jest.fn().mockResolvedValue(undefined),
  };

  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AuthService(
      usersService as unknown as UsersService,
      jwtService as unknown as JwtService,
      config as unknown as ConfigService,
      audit as unknown as AuditService,
    );
  });

  describe('register', () => {
    it('creates user, audits, and returns token', async () => {
      const user = {
        id: 'u-new',
        email: 'new@test.com',
        name: 'New',
        role: UserRole.USER,
      };
      usersService.createUser.mockResolvedValue(user);

      const result = await service.register({
        name: 'New',
        email: 'new@test.com',
        password: 'password12',
      });

      expect(result.accessToken).toBe('signed.jwt.token');
      expect(result.refreshToken).toBe('signed.jwt.token');
      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({ tokenUse: 'refresh' }),
        expect.objectContaining({
          secret: 'refresh-secret',
          expiresIn: '15h',
        }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'auth.register',
          userId: 'u-new',
          status: 'ok',
        }),
      );
    });
  });

  describe('login', () => {
    it('returns token and audits success for valid credentials', async () => {
      const passwordHash = await bcrypt.hash('secret123', 4);
      usersService.findByEmail.mockResolvedValue({
        id: 'u1',
        email: 'user@test.com',
        name: 'User',
        role: UserRole.USER,
        passwordHash,
      });

      const result = await service.login({
        email: 'user@test.com',
        password: 'secret123',
      });

      expect(result.accessToken).toBe('signed.jwt.token');
      expect(result.refreshToken).toBe('signed.jwt.token');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'auth.login',
          status: 'ok',
          userId: 'u1',
        }),
      );
    });

    it('audits error and throws for bad password', async () => {
      const passwordHash = await bcrypt.hash('secret123', 4);
      usersService.findByEmail.mockResolvedValue({
        id: 'u1',
        email: 'user@test.com',
        name: 'User',
        role: UserRole.USER,
        passwordHash,
      });

      await expect(
        service.login({ email: 'user@test.com', password: 'wrong' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'auth.login',
          status: 'error',
        }),
      );
    });

    it('throws for unknown email (still runs bcrypt compare)', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      await expect(
        service.login({ email: 'missing@test.com', password: 'x' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('refresh', () => {
    it('validates a refresh token and issues a new token pair', async () => {
      const user = {
        id: 'u1',
        email: 'user@test.com',
        name: 'User',
        role: UserRole.USER,
      };
      jwtService.verifyAsync.mockResolvedValue({
        sub: user.id,
        email: user.email,
        role: user.role,
        tokenUse: 'refresh',
      });
      usersService.findByIdOrFail.mockResolvedValue(user);

      const result = await service.refresh('valid.refresh.token');

      expect(jwtService.verifyAsync).toHaveBeenCalledWith(
        'valid.refresh.token',
        { secret: 'refresh-secret' },
      );
      expect(result.accessToken).toBe('signed.jwt.token');
      expect(result.refreshToken).toBe('signed.jwt.token');
    });

    it('rejects invalid or expired refresh tokens', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('jwt expired'));

      await expect(service.refresh('expired.refresh.token')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejects an access token presented as a refresh token', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: 'u1',
        email: 'user@test.com',
      });

      await expect(service.refresh('access.token')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(usersService.findByIdOrFail).not.toHaveBeenCalled();
    });
  });
});
