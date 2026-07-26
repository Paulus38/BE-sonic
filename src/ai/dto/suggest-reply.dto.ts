import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SuggestReplyDto {
  @ApiProperty({
    description: 'Recent transcript lines, e.g. "Speaker 1: How are you?"',
  })
  @IsString()
  @MinLength(2)
  @MaxLength(8000)
  context!: string;

  @ApiPropertyOptional({ description: 'Recording category / topic' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  category?: string;
}
