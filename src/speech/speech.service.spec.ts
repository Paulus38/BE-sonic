import { ConfigService } from '@nestjs/config';
import { SpeechService } from './speech.service';
import { GeminiSpeechProvider } from './providers/gemini-speech.provider';
import { DeepgramSpeechProvider } from './providers/deepgram-speech.provider';
import { SpeechProviderType } from '../common/enums';

function makeService(
  mode: SpeechProviderType,
  deepgram: Partial<DeepgramSpeechProvider>,
  gemini: Partial<GeminiSpeechProvider>,
) {
  const config = {
    get: jest.fn((key: string) =>
      key === 'app.speechProvider' ? mode : undefined,
    ),
  } as unknown as ConfigService;

  return new SpeechService(
    config,
    {
      name: 'gemini',
      isReady: () => false,
      createSession: jest.fn(),
      ...gemini,
    } as unknown as GeminiSpeechProvider,
    {
      name: 'deepgram',
      isReady: () => false,
      createSession: jest.fn(),
      ...deepgram,
    } as unknown as DeepgramSpeechProvider,
  );
}

describe('SpeechService.transcribeFile', () => {
  const buffer = Buffer.from('fake-audio');

  it('uses Deepgram when ready', async () => {
    const service = makeService(
      SpeechProviderType.AUTO,
      {
        isReady: () => true,
        transcribeBuffer: jest.fn().mockResolvedValue('hello deepgram'),
      },
      { isReady: () => true },
    );

    const result = await service.transcribeFile({
      buffer,
      mimeType: 'audio/webm',
      language: 'en',
    });

    expect(result).toEqual({ text: 'hello deepgram', provider: 'deepgram' });
  });

  it('falls back to Gemini when Deepgram fails', async () => {
    const service = makeService(
      SpeechProviderType.AUTO,
      {
        isReady: () => true,
        transcribeBuffer: jest
          .fn()
          .mockRejectedValue(new Error('quota exceeded')),
      },
      {
        isReady: () => true,
        transcribeBuffer: jest.fn().mockResolvedValue('hello gemini'),
      },
    );

    const result = await service.transcribeFile({
      buffer,
      mimeType: 'audio/webm',
      language: 'en',
      userId: 'u1',
    });

    expect(result).toEqual({ text: 'hello gemini', provider: 'gemini' });
  });

  it('throws combined error when both providers fail', async () => {
    const service = makeService(
      SpeechProviderType.AUTO,
      {
        isReady: () => true,
        transcribeBuffer: jest.fn().mockRejectedValue(new Error('dg fail')),
      },
      {
        isReady: () => true,
        transcribeBuffer: jest.fn().mockRejectedValue(new Error('gm fail')),
      },
    );

    await expect(
      service.transcribeFile({ buffer, mimeType: 'audio/webm' }),
    ).rejects.toThrow(/Deepgram: dg fail/);
  });

  it('throws when no provider is ready', async () => {
    const service = makeService(
      SpeechProviderType.AUTO,
      { isReady: () => false },
      { isReady: () => false },
    );

    await expect(
      service.transcribeFile({ buffer, mimeType: 'audio/webm' }),
    ).rejects.toThrow(/No speech provider ready/);
  });
});

describe('SpeechService.createSession', () => {
  it('throws when no provider ready', () => {
    const service = makeService(
      SpeechProviderType.GEMINI,
      { isReady: () => false },
      { isReady: () => false },
    );

    expect(() => service.createSession({ language: 'en' })).toThrow(
      /No speech provider is ready/,
    );
  });

  it('returns a session from the first ready provider', () => {
    const session = {
      start: jest.fn(),
      sendAudio: jest.fn(),
      stop: jest.fn(),
    };
    const service = makeService(
      SpeechProviderType.DEEPGRAM,
      {
        isReady: () => true,
        createSession: jest.fn().mockReturnValue(session),
      },
      { isReady: () => false },
    );

    expect(service.createSession({ language: 'en' })).toBe(session);
    expect(service.getProviderName()).toBe('deepgram');
  });
});
