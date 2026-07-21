import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ImportDuolingoDto {
  @ApiProperty({
    description:
      'Duolingo JWT token extracted from logged-in browser session cookies.',
  })
  @IsString()
  jwtToken!: string;

  @ApiProperty({ required: false, default: 'en' })
  @IsOptional()
  @IsString()
  learningLanguage?: string;

  @ApiProperty({ required: false, default: 'vi' })
  @IsOptional()
  @IsString()
  nativeLanguage?: string;

  @ApiProperty({ required: false, default: 100, minimum: 1, maximum: 500 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}
