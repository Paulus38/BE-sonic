import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
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
  time!: string;

  @ApiProperty()
  @IsString()
  speaker!: string;

  @ApiProperty()
  @IsString()
  text!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  translation?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  tStartMs?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
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
  durationSec!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TranscriptLineDto)
  transcript?: TranscriptLineDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  generateSummary?: boolean;
}
