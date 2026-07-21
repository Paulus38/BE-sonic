import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { DictionaryService } from './dictionary.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/user.entity';
import { CreateDictionaryItemDto } from './dto/create-dictionary-item.dto';
import { PaginationDto } from '../common/dto/pagination.dto';

@ApiTags('dictionary')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/v1/dictionary')
export class DictionaryController {
  constructor(private readonly dictionaryService: DictionaryService) {}

  @Post()
  create(@CurrentUser() user: User, @Body() dto: CreateDictionaryItemDto) {
    return this.dictionaryService.create(user.id, dto);
  }

  @Get()
  list(@CurrentUser() user: User, @Query() query: PaginationDto) {
    return this.dictionaryService.list(user.id, query);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.dictionaryService.remove(user.id, id);
  }
}
