import {
  Controller,
  UseGuards,
  Patch,
  Param,
  Body,
  Post,
  Req,
  Get,
  Query,
  Delete,
  UseInterceptors,
  UploadedFile,
  ParseFilePipeBuilder,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import type { AuthUser } from '../auth/auth.types';
import { StoreService } from './store.service';
import { CreateStoreDto } from './dto/create-store.dto';
import { UpdateStoreDto } from './dto/update-store.dto';
import { StoreDetailDto } from './dto/store-detail.dto';
import { MyStoreDetailDto } from './dto/mystore-detail.dto';
import { StoreResponseDto } from './dto/store-response.dto';
import { MyInterestStoreDto } from './dto/register-interest-store.dto';
import { MyStoreProductQueryDto } from './dto/store-product-query.dto';
import { MyStoreProductListWrapperDto } from './dto/store-product-wrapper.dto';
import { ParseCuidPipe } from '../common/pipes/parse-cuid.pipe';
import {
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { CreateStoreResponseDto } from './dto/create-store-response.dto';
import { S3Service } from '../s3/s3.service';
import { imageFileFilter } from '../s3/s3.controller';
import { UpdateStoreFormDto } from './dto/update-store-form.dto';
import { memoryStorage } from 'multer';

@ApiTags('stores')
@Controller('api/stores')
export class StoreController {
  constructor(
    private readonly storeService: StoreService,
    private readonly s3Service: S3Service,
  ) {}

  // 새 스토어 등록
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '새 스토어 등록' })
  @ApiResponse({
    status: 201,
    description: '등록된 스토어 정보를 반환합니다.',
  })
  @Post()
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('image', {
      storage: memoryStorage(),
      fileFilter: imageFileFilter,
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  async create(
    @Req() req: { user: AuthUser },
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({
          fileType: /(jpg|jpeg|png|gif)$/i,
        })
        .addMaxSizeValidator({ maxSize: 10 * 1024 * 1024 })
        .build({ fileIsRequired: false }),
    )
    file: Express.Multer.File | undefined,
    @Body() dto: CreateStoreDto,
  ): Promise<CreateStoreResponseDto> {
    const user = req.user;

    if (file) {
      const { url } = await this.s3Service.uploadFile(file);
      dto.image = url;
    }

    const createdStore = await this.storeService.createStore(
      user.userId,
      user.type,
      dto,
    );

    return {
      id: createdStore.id,
      storeName: createdStore.name,
      phoneNumber: createdStore.phoneNumber,
      description: createdStore.content,
      address: {
        basic: createdStore.address,
        ...(createdStore.detailAddress
          ? { detail: createdStore.detailAddress }
          : {}),
      },
      image: createdStore.image ?? undefined,
      createdAt: createdStore.createdAt,
      updatedAt: createdStore.updatedAt,
    };
  }

  // 내 스토어 상세 조회
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '내 스토어 상세 조회' })
  @ApiResponse({
    status: 200,
    description: '스토어 정보를 반환합니다.',
  })
  @Get('detail/my')
  getMyStoreDetail(@Req() req: { user: AuthUser }): Promise<MyStoreDetailDto> {
    const user = req.user;
    return this.storeService.getMyStoreDetail(user.userId, user.type);
  }

  // 내 스토어 상품 목록 조회
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '내 스토어 상품 목록 조회' })
  @ApiResponse({
    status: 200,
    description: '스토어 등록 상품 정보를 반환합니다.',
  })
  @Get('detail/my/product')
  getMyStoreProducts(
    @Req() req: { user: AuthUser },
    @Query() query: MyStoreProductQueryDto,
  ): Promise<MyStoreProductListWrapperDto> {
    const { userId, type } = req.user;
    return this.storeService.getMyStoreProducts(userId, type, query);
  }

  // 관심 스토어 등록
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '관심 스토어 등록' })
  @ApiResponse({
    status: 201,
    description: '관심 스토어 등록',
  })
  @Post(':storeId/favorite')
  registerInterestStore(
    @Param('storeId', ParseCuidPipe) storeId: string,
    @Req() req: { user: AuthUser },
  ): Promise<{ store: MyInterestStoreDto }> {
    const user = req.user;
    return this.storeService.registerInterestStore(storeId, user.userId);
  }

  // 관심 스토어 해제
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '관심 스토어 해제' })
  @ApiResponse({
    status: 200,
    description: '관심 스토어 해제',
  })
  @Delete(':storeId/favorite')
  deleteInterestStore(
    @Param('storeId', ParseCuidPipe) storeId: string,
    @Req() req: { user: AuthUser },
  ): Promise<{ store: MyInterestStoreDto }> {
    const user = req.user;
    return this.storeService.deleteInterestStore(storeId, user.userId);
  }

  // 스토어 상세 조회
  @ApiOperation({ summary: '스토어 상세 조회' })
  @ApiResponse({
    status: 200,
    description: '스토어 정보를 반환합니다.',
  })
  @Get(':storeId')
  getStoreDetail(
    @Param('storeId', ParseCuidPipe) storeId: string,
  ): Promise<StoreDetailDto> {
    return this.storeService.getStoreDetail(storeId);
  }

  // 스토어 수정
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '스토어 수정' })
  @ApiResponse({
    status: 200,
    description: '수정된 스토어 정보를 반환합니다.',
  })
  @Patch(':storeId')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('image', {
      storage: memoryStorage(),
      fileFilter: imageFileFilter,
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  async updateStore(
    @Param('storeId', ParseCuidPipe) storeId: string,
    @Req() req: Request & { user: { userId: string; type: any } },
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({
          fileType: /(jpg|jpeg|png|gif)$/i,
        })
        .addMaxSizeValidator({ maxSize: 10 * 1024 * 1024 })
        .build({ fileIsRequired: false }),
    )
    file: Express.Multer.File | undefined,
    @Body()
    form: UpdateStoreFormDto,
  ): Promise<StoreResponseDto> {
    const { userId, type } = req.user;

    const dto: UpdateStoreDto = {
      name: form.name,
      address: form.address,
      detailAddress: form.detailAddress,
      phoneNumber: form.phoneNumber,
      content: form.content,
      image: form.image,
    };

    if (form.removeImage?.toLowerCase() === 'true') dto.image = null;
    else if (file) {
      const { url } = await this.s3Service.uploadFile(file);
      dto.image = url;
    } else if (form.image) {
      dto.image = form.image;
    }

    return this.storeService.updateStore(storeId, userId, type, dto);
  }
}
