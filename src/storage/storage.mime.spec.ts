import {
  normalizeMimeType,
  isAllowedAudioMime,
  StorageService,
} from './storage.service';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterFile } from '../common/types/uploaded-file';

function makeStorageService(maxMb = 50): StorageService {
  const config = {
    get: (key: string) => {
      if (key === 'app.maxAudioMb') return maxMb;
      if (key === 'app.uploadDir') return './uploads';
      return undefined;
    },
  } as unknown as ConfigService;

  return new StorageService(
    config,
    { isReady: () => false } as never,
    { isReady: () => false } as never,
    { isReady: () => false } as never,
    { isReady: () => false } as never,
  );
}

describe('normalizeMimeType / isAllowedAudioMime', () => {
  it('strips codecs parameter from Chrome MediaRecorder type', () => {
    expect(normalizeMimeType('audio/webm;codecs=opus')).toBe('audio/webm');
    expect(isAllowedAudioMime('audio/webm;codecs=opus')).toBe(true);
  });

  it('normalizes case and whitespace', () => {
    expect(normalizeMimeType('  Audio/WebM  ')).toBe('audio/webm');
  });

  it('allows aac / m4a used on Safari/mobile', () => {
    expect(isAllowedAudioMime('audio/aac')).toBe(true);
    expect(isAllowedAudioMime('audio/x-m4a')).toBe(true);
  });

  it('rejects unknown types', () => {
    expect(isAllowedAudioMime('application/pdf')).toBe(false);
    expect(isAllowedAudioMime('')).toBe(false);
  });
});

describe('StorageService.assertValidAudio', () => {
  const service = makeStorageService(1);

  it('accepts webm;codecs and rewrites mimetype to base', () => {
    const file = {
      mimetype: 'audio/webm;codecs=opus',
      size: 100,
      buffer: Buffer.from('x'),
      originalname: 'a.webm',
      fieldname: 'file',
    } as MulterFile;

    expect(() => service.assertValidAudio(file)).not.toThrow();
    expect(file.mimetype).toBe('audio/webm');
  });

  it('throws when file missing', () => {
    expect(() => service.assertValidAudio(undefined)).toThrow(
      BadRequestException,
    );
  });

  it('throws when over size limit', () => {
    const file = {
      mimetype: 'audio/webm',
      size: 2 * 1024 * 1024,
      buffer: Buffer.alloc(1),
      originalname: 'a.webm',
      fieldname: 'file',
    } as MulterFile;

    expect(() => service.assertValidAudio(file)).toThrow(BadRequestException);
  });
});
