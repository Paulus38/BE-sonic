import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateDictionaryItemDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  word!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  phonetic?: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  definition!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  example?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  recordingId?: string;
}
