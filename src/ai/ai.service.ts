import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly client: GoogleGenAI | null;
  private readonly model: string;
  private readonly cache = new Map<string, string>();

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('app.geminiApiKey');
    this.model = this.config.get<string>('app.geminiModel') ?? 'gemini-2.0-flash';
    this.client = apiKey ? new GoogleGenAI({ apiKey }) : null;
    if (!this.client) {
      this.logger.warn('GEMINI_API_KEY missing — AI features use safe fallbacks');
    }
  }

  isAvailable(): boolean {
    return !!this.client;
  }

  async summarize(
    text: string,
    title: string,
    category: string,
  ): Promise<string> {
    const fallback = this.buildLocalSummary(text, title, category);
    if (!this.client || !text.trim()) {
      return fallback;
    }

    try {
      const response = await this.client.models.generateContent({
        model: this.model,
        contents: `Tóm tắt ngắn gạch đầu dòng tiếng Việt:
Tiêu đề: ${title}
Chủ đề: ${category}
"""${text.slice(0, 8000)}"""`,
      });
      return response.text?.trim() || fallback;
    } catch (err) {
      this.logger.warn(
        `Summarize failed, using local fallback: ${err instanceof Error ? err.message : String(err)}`,
      );
      return fallback;
    }
  }

  buildLocalSummary(text: string, title: string, category: string): string {
    const lines = text
      .split(/[.!?]\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 8)
      .slice(0, 5);
    if (!lines.length) {
      return `Tóm tắt "${title}" (${category}):\n- Nội dung đã được ghi nhận.\n- Xem lại transcript để nắm chi tiết.`;
    }
    return `Tóm tắt "${title}" (${category}):\n${lines.map((l) => `- ${l}`).join('\n')}`;
  }

  /**
   * Live EN→VI translation.
   * Prefer free translators first (Gemini often hits free-tier 429),
   * then Gemini. Never echo English as a fake Vietnamese result.
   */
  async translateLive(text: string): Promise<string> {
    const cleaned = text.trim();
    if (!cleaned) return '';

    const cacheKey = cleaned.toLowerCase();
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    let translated =
      (await this.translateViaGoogle(cleaned)) ||
      (await this.translateViaMyMemory(cleaned)) ||
      (await this.translateViaGeminiFast(cleaned));

    if (!translated || !this.isUsefulVietnamese(cleaned, translated)) {
      translated = '';
    }

    if (translated) {
      if (this.cache.size > 500) {
        const first = this.cache.keys().next().value;
        if (first) this.cache.delete(first);
      }
      this.cache.set(cacheKey, translated);
    }
    return translated;
  }

  async translate(text: string, _targetLang = 'Tiếng Việt'): Promise<string> {
    return this.translateLive(text);
  }

  private isUsefulVietnamese(source: string, translated: string): boolean {
    const out = translated.trim();
    if (!out) return false;
    if (out.toLowerCase() === source.toLowerCase()) return false;
    // Prefer results that contain Vietnamese diacritics when source is English
    const hasVi =
      /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(
        out,
      );
    const sourceLooksEnglish = /[a-z]/i.test(source) && !hasVi;
    if (sourceLooksEnglish && !hasVi && out.split(/\s+/).length <= 2) {
      return false;
    }
    return true;
  }

  private async translateViaGoogle(text: string): Promise<string | null> {
    try {
      const url =
        'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=vi&dt=t&q=' +
        encodeURIComponent(text.slice(0, 1500));
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) return null;
      const data = (await res.json()) as unknown;
      if (!Array.isArray(data) || !Array.isArray(data[0])) return null;
      const out = data[0]
        .map((chunk: unknown) =>
          Array.isArray(chunk) && typeof chunk[0] === 'string' ? chunk[0] : '',
        )
        .join('')
        .trim();
      return out || null;
    } catch (err) {
      this.logger.debug(
        `Google translate failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  private async translateViaMyMemory(text: string): Promise<string | null> {
    try {
      const url =
        'https://api.mymemory.translated.net/get?q=' +
        encodeURIComponent(text.slice(0, 500)) +
        '&langpair=en|vi';
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) return null;
      const data = (await res.json()) as {
        responseData?: { translatedText?: string };
        responseStatus?: number;
      };
      const out = data.responseData?.translatedText?.trim();
      if (!out || data.responseStatus !== 200) return null;
      if (out.toLowerCase() === text.toLowerCase() && /[a-z]/i.test(text)) {
        return null;
      }
      return out;
    } catch (err) {
      this.logger.debug(
        `MyMemory failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  private async translateViaGeminiFast(text: string): Promise<string | null> {
    if (!this.client) return null;
    const models = Array.from(
      new Set([
        this.model,
        'gemini-2.0-flash',
        'gemini-1.5-flash',
        'gemini-2.5-flash',
      ]),
    );
    for (const model of models) {
      try {
        const response = await this.client.models.generateContent({
          model,
          contents: `Bạn là phiên dịch Anh→Việt chuyên nghiệp (họp/phỏng vấn/học tiếng Anh).
Dịch tự nhiên, đúng nghĩa, giữ thuật ngữ kỹ thuật nếu phổ biến.
CHỈ trả về bản dịch tiếng Việt, không giải thích, không ngoặc kép.

EN: ${text.slice(0, 1200)}`,
        });
        const out = response.text?.trim();
        if (!out) continue;
        return out.replace(/^["«]|["»]$/g, '').trim();
      } catch (err) {
        this.logger.warn(
          `Gemini translate failed (${model}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return null;
  }

  async transcribeAudio(
    audioBase64: string,
    mimeType: string,
    category: string,
  ): Promise<string> {
    if (!this.client) {
      throw new Error('Gemini API key is not configured');
    }

    const response = await this.client.models.generateContent({
      model: this.model,
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `Transcribe accurately (${category}). Return only spoken words.`,
            },
            { inlineData: { mimeType, data: audioBase64 } },
          ],
        },
      ],
    });

    return (response.text ?? '').trim();
  }
}
