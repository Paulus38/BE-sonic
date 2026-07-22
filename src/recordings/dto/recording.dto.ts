import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RecordingCategory } from '../../common/enums';

export class CreateRecordingDto {
  @ApiProperty()
  @IsString()
  @MaxLength(255)
  title!: string;

  @ApiPropertyOptional({ enum: RecordingCategory })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  category?: string;
}

export class TranscriptLineDto {
  @ApiProperty()
  @IsString()
  @MaxLength(32)
  time!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(64)
  speaker!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(4000)
  text!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  translation?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(86_400_000)
  tStartMs?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(86_400_000)
  tEndMs?: number;
}

export class FinalizeRecordingDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  category?: string;

  @ApiProperty()
  @IsInt()
  @Min(0)
  @Max(86_400)
  durationSec!: number;

  @ApiPropertyOptional({
    description: 'Max 3000 lines to prevent oversized writes / AI cost abuse',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3000)
  @ValidateNested({ each: true })
  @Type(() => TranscriptLineDto)
  transcript?: TranscriptLineDto[];

  @ApiPropertyOptional({
    description:
      'When true, call Gemini to generate aiSummary. Default false to avoid burning tokens on save.',
  })
  @IsOptional()
  @IsBoolean()
  generateSummary?: boolean;
}

export class RetranscribeRecordingDto {
  @ApiPropertyOptional({ enum: ['en', 'vi'], default: 'en' })
  @IsOptional()
  @IsString()
  language?: 'en' | 'vi';

  @ApiPropertyOptional({
    description: 'Translate EN→VI after STT (free translators first). Default true when language=en.',
  })
  @IsOptional()
  @IsBoolean()
  translate?: boolean;
}
