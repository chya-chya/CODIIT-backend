// 📁 src/products/products.controller.ts
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiOperation, ApiConsumes, ApiBody, ApiTags } from '@nestjs/swagger';
import { ProductsService } from './products.service';
import { CreateProductDto, CreateStockDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { FindProductsQueryDto } from './dto/find-products-query.dto';
import { CreateInquiryDto } from './dto/create-inquiry.dto';
import { Inquiry } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt.guard';
import type { RequestWithUser } from '../auth/auth.types';
import type {
  ProductResponse,
  ProductListResponse,
  InquiryResponse,
} from './products.service';
import { S3Service } from '../s3/s3.service';
import { imageFileFilter } from '../s3/s3.controller';

@ApiTags('Products')
@Controller('api/products')
export class ProductsController {
  constructor(
    private readonly productsService: ProductsService,
    private readonly s3Service: S3Service,
  ) {}

  /** ✅ 상품 등록 (이미지 포함 FormData) */
  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '상품 등록 (FormData)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: '상품 등록 요청',
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', example: '운동화' },
        price: { type: 'number', example: 10000 },
        categoryName: { type: 'string', example: 'TOP' },
        content: { type: 'string', example: '<p>상품 설명입니다.</p>' },
        discountRate: { type: 'number', example: 10 },
        image: {
          type: 'string',
          format: 'binary',
          description: '상품 이미지 파일',
        },
        stocks: {
          type: 'string',
          example:
            '[{"sizeId":"clvxyz123","quantity":10},{"sizeId":"clvxyz456","quantity":5}]',
        },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('image', {
      fileFilter: imageFileFilter,
      limits: { fileSize: 1024 * 1024 * 10 }, // 10MB 제한
    }),
  )
  async create(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: Record<string, unknown>,
    @Req() req: RequestWithUser,
  ): Promise<ProductResponse> {
    const sellerId = req.user.userId;

    // ✅ DTO 변환
    const dto = {
      ...body,
      price: Number(body.price),
      discountRate:
        body.discountRate !== undefined ? Number(body.discountRate) : undefined,
    } as unknown as CreateProductDto;

    // ✅ 이미지 처리 (S3 업로드 or 기본 이미지)
    if (file) {
      const result = await this.s3Service.uploadFile(file);
      dto.image = result.url;
    } else {
      dto.image =
        'https://nb02-codiit-team2.s3.ap-northeast-2.amazonaws.com/default-product.png';
    }

    // ✅ stocks 문자열 처리 (FormData → JSON 변환)
    if (typeof dto.stocks === 'string') {
      try {
        const parsed = JSON.parse(dto.stocks) as Array<{
          sizeId: string | number;
          quantity: number;
        }>;

        if (!Array.isArray(parsed)) {
          throw new BadRequestException('Stocks must be an array');
        }

        dto.stocks = parsed.map((item) => ({
          sizeId: String(item.sizeId),
          quantity: Number(item.quantity),
        })) as CreateStockDto[];
      } catch {
        throw new BadRequestException('Invalid stocks format');
      }
    }

    return await this.productsService.create(dto, sellerId);
  }

  /** ✅ 상품 목록 조회 */
  @Get()
  async findAll(
    @Query() query: FindProductsQueryDto,
  ): Promise<ProductListResponse> {
    return await this.productsService.findAll(query);
  }

  /** ✅ 상품 상세 조회 */
  @Get(':id')
  async findOne(@Param('id') id: string): Promise<ProductResponse> {
    return await this.productsService.findOne(id);
  }

  /** ✅ 상품 수정 (FormData 대응 + 이미지 업로드 포함) */
  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '상품 수정 (FormData)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: '상품 수정 요청',
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', example: '수정된 운동화' },
        price: { type: 'number', example: 12000 },
        categoryName: { type: 'string', example: 'TOP' },
        content: { type: 'string', example: '<p>수정된 상품 설명입니다.</p>' },
        discountRate: { type: 'number', example: 5 },
        image: {
          type: 'string',
          format: 'binary',
          description: '새 이미지 파일',
        },
        stocks: {
          type: 'string',
          example:
            '[{"sizeId":"clvxyz123","quantity":20},{"sizeId":"clvxyz456","quantity":8}]',
        },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('image', {
      fileFilter: imageFileFilter,
      limits: { fileSize: 1024 * 1024 * 10 },
    }),
  )
  async update(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: Record<string, unknown>,
    @Req() req: RequestWithUser,
  ): Promise<ProductResponse> {
    const sellerId = req.user.userId;

    // ✅ DTO 변환
    const dto = {
      ...body,
      price:
        body.price !== undefined && body.price !== ''
          ? Number(body.price)
          : undefined,
      discountRate:
        body.discountRate !== undefined && body.discountRate !== ''
          ? Number(body.discountRate)
          : undefined,
      discountStartTime:
        typeof body.discountStartTime === 'string'
          ? body.discountStartTime
          : body.discountStartTime
            ? new Date(
                body.discountStartTime as string | number | Date,
              ).toISOString()
            : undefined,

      discountEndTime:
        typeof body.discountEndTime === 'string'
          ? body.discountEndTime
          : body.discountEndTime
            ? new Date(
                body.discountEndTime as string | number | Date,
              ).toISOString()
            : undefined,
      isSoldOut:
        body.isSoldOut === 'true' || body.isSoldOut === true ? true : undefined,
    } as unknown as UpdateProductDto;

    // ✅ 이미지 업로드 (S3 or 기존 유지)
    if (file) {
      const result = await this.s3Service.uploadFile(file);
      dto.image = result.url;
    } else if (typeof body.image === 'string' && body.image !== '') {
      dto.image = String(body.image); // 기존 이미지 유지
    } else {
      dto.image = undefined;
    }

    // ✅ stocks 문자열 → JSON 변환
    if (typeof dto.stocks === 'string') {
      try {
        const parsed = JSON.parse(dto.stocks) as Array<{
          sizeId: string | number;
          quantity: number;
        }>;

        dto.stocks = parsed.map((item) => ({
          sizeId: String(item.sizeId),
          quantity: Number(item.quantity),
        }));
      } catch {
        throw new BadRequestException('Invalid stocks format');
      }
    }

    return await this.productsService.update(id, dto, sellerId);
  }

  /** ✅ 상품 삭제 */
  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id') id: string,
    @Req() req: RequestWithUser,
  ): Promise<void> {
    return await this.productsService.remove(id, req.user.userId);
  }

  /** ✅ 상품 문의 등록 */
  @Post(':id/inquiries')
  @UseGuards(JwtAuthGuard)
  async createInquiry(
    @Param('id') productId: string,
    @Body() dto: CreateInquiryDto,
    @Req() req: RequestWithUser,
  ): Promise<Inquiry> {
    return await this.productsService.createInquiry(productId, dto, req.user.userId);
  }

  /** ✅ 상품 문의 조회 */
  @Get(':id/inquiries')
  @UseGuards(JwtAuthGuard)
  async findInquiries(
    @Param('id') productId: string,
    @Req() req: RequestWithUser,
  ): Promise<InquiryResponse> {
    return await this.productsService.findInquiries(productId, req.user.userId);
  }
}
