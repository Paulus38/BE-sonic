import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterPushTokenDto {
  @ApiProperty({ description: 'FCM device token from the mobile app' })
  @IsString()
  @MinLength(10)
  token!: string;
}
