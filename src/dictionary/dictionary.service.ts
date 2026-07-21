import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { DictionaryItem } from './dictionary-item.entity';
import { CreateDictionaryItemDto } from './dto/create-dictionary-item.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { ImportDuolingoDto } from './dto/import-duolingo.dto';

@Injectable()
export class DictionaryService {
  constructor(
    @InjectRepository(DictionaryItem)
    private readonly repo: Repository<DictionaryItem>,
  ) {}

  async create(userId: string, dto: CreateDictionaryItemDto) {
    const item = this.repo.create({
      userId,
      word: dto.word.trim(),
      phonetic: dto.phonetic?.trim() ?? null,
      definition: dto.definition.trim(),
      example: dto.example?.trim() ?? '',
      category: dto.category ?? 'Học Tiếng Anh',
      recordingId: dto.recordingId ?? null,
    });
    return this.toDto(await this.repo.save(item));
  }

  async list(userId: string, query: PaginationDto) {
    const [items, total] = await this.repo.findAndCount({
      where: { userId },
      order: { createdAt: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
    return {
      items: items.map((i) => this.toDto(i)),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit) || 1,
      },
    };
  }

  async remove(userId: string, id: string): Promise<void> {
    const result = await this.repo.softDelete({ id, userId });
    if (!result.affected) {
      throw new NotFoundException('Dictionary item not found');
    }
  }

  async importFromDuolingo(userId: string, dto: ImportDuolingoDto) {
    const token = dto.jwtToken.trim();
    if (!token) {
      throw new BadRequestException('Duolingo token is required');
    }

    let response: Response;
    try {
      response = await fetch(
        'https://www.duolingo.com/vocabulary/overview',
        {
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${token}`,
            jwt: token,
            Cookie: `jwt_token=${token}`,
          },
        },
      );
    } catch (err) {
      throw new BadRequestException(
        `Cannot reach Duolingo: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!response.ok) {
      throw new BadRequestException(
        `Duolingo import failed (${response.status}). Check token validity.`,
      );
    }

    let payload: {
      vocab_overview?: Array<{
        word_string?: string;
        normalized_string?: string;
      }>;
    };
    try {
      payload = (await response.json()) as typeof payload;
    } catch {
      throw new BadRequestException(
        'Duolingo returned invalid JSON. Token may be expired.',
      );
    }

    const rawWords = (payload.vocab_overview ?? [])
      .map((v) => (v.word_string || v.normalized_string || '').trim())
      .filter((w) => w.length > 1);

    const uniqueWords = Array.from(new Set(rawWords))
      .slice(0, dto.limit ?? 100)
      .map((word) => word.slice(0, 120));

    if (!uniqueWords.length) {
      throw new BadRequestException(
        'No vocabulary found from Duolingo response.',
      );
    }

    const existing = await this.repo.find({
      where: { userId, word: In(uniqueWords) },
      select: ['word'],
    });
    const existingSet = new Set(existing.map((e) => e.word.toLowerCase()));

    const toCreate = uniqueWords
      .filter((word) => !existingSet.has(word.toLowerCase()))
      .map((word) =>
        this.repo.create({
          userId,
          word,
          phonetic: null,
          definition: `Từ vựng import từ Duolingo (${dto.learningLanguage ?? 'en'}).`,
          example: '',
          category: 'Học Tiếng Anh',
          recordingId: null,
        }),
      );

    if (toCreate.length) {
      await this.repo.save(toCreate);
    }

    return {
      totalReceived: uniqueWords.length,
      imported: toCreate.length,
      skipped: uniqueWords.length - toCreate.length,
    };
  }

  private toDto(item: DictionaryItem) {
    return {
      id: item.id,
      word: item.word,
      phonetic: item.phonetic ?? undefined,
      definition: item.definition,
      example: item.example,
      category: item.category,
      recordingId: item.recordingId ?? undefined,
    };
  }
}
