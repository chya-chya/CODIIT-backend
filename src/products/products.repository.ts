// 📁 src/products/products.repository.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, Product, Inquiry, CategoryType } from '@prisma/client';
import { FindProductsQueryDto } from './dto/find-products-query.dto';
import { CreateInquiryDto } from './dto/create-inquiry.dto';
import { TransformedStock } from './dto/create-product.dto';
import type { InquiryWithRelations } from '../types/inquiry-with-relations.type';

// 🔧 Relation 포함된 타입 정의
export type ProductWithRelations = Prisma.ProductGetPayload<{
  include: {
    store: { select: { name: true } };
    reviews: { select: { rating: true } };
    stocks: { include: { size: true } };
  };
}>;

export type ProductDetailWithRelations = Prisma.ProductGetPayload<{
  include: {
    store: true;
    category: true;
    stocks: { include: { size: true } };
    reviews: true;
    inquiries: true;
  };
}>;

import { SearchService } from '../search/search.service';

@Injectable()
export class ProductsRepository {
  /** 💾 전체 상품 개수 글로벌 캐시 (필터 없을 때 사용) */
  private globalCountCache: { count: number; expireAt: number } | null = null;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5분

  constructor(
    private readonly prisma: PrismaService,
    private readonly searchService: SearchService,
  ) { }

  /** ✅ 스토어 ID로 조회 (PK) */
  async findStoreById(storeId: string) {
    return this.prisma.store.findUnique({ where: { id: storeId } });
  }

  /** ✅ 판매자 ID로 스토어 조회 (unique) */
  async findStoreBySellerId(sellerId: string) {
    return this.prisma.store.findUnique({ where: { sellerId } });
  }

  /** ⚙️ 카테고리명으로 카테고리 조회 */
  async findCategoryByName(name: CategoryType) {
    return this.prisma.category.findFirst({
      where: { name: name as Prisma.EnumCategoryTypeFilter<'Category'> },
    });
  }

  /** ⚙️ 사이즈명으로 사이즈 조회 */
  async findStockSizeByName(name: string) {
    return this.prisma.stockSize.findFirst({ where: { name } });
  }

  /** ✅ 사이즈 ID로 조회 */
  async findStockSizeById(sizeId: string) {
    return this.prisma.stockSize.findUnique({ where: { id: sizeId } });
  }

  /** ✅ 상품 등록 */
  async create(data: {
    name: string;
    content?: string;
    image?: string;
    price: number;
    discountRate?: number;
    discountPrice?: number;
    discountStartTime?: string;
    discountEndTime?: string;
    storeId: string;
    categoryId: string;
    stocks: TransformedStock[];
  }): Promise<Product> {
    return this.prisma.product.create({
      data: {
        name: data.name,
        content: data.content,
        image: data.image,
        price: data.price,
        discountRate: data.discountRate,
        discountPrice: data.discountPrice,
        discountStartTime: data.discountStartTime
          ? new Date(data.discountStartTime)
          : undefined,
        discountEndTime: data.discountEndTime
          ? new Date(data.discountEndTime)
          : undefined,
        storeId: data.storeId,
        categoryId: data.categoryId,
        stocks: {
          create: data.stocks.map((s) => ({
            sizeId: s.sizeId,
            quantity: s.quantity,
          })),
        },
      },
    });
  }

  /** ✅ 카테고리 자동 생성 (없으면 생성, 있으면 그대로 반환) */
  async upsertCategory(name: CategoryType) {
    return this.prisma.category.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  /** ✅ 사이즈 자동 생성 (id 자동 생성, 중복 방지) */
  async createStockSize(data: { id?: string; name: string }) {
    const existing = await this.prisma.stockSize.findFirst({
      where: { name: data.name },
    });
    if (existing) return existing;

    return this.prisma.stockSize.create({
      data: { name: data.name },
    });
  }

  /** ✅ 상품 목록 조회 */
  async findAll(query: FindProductsQueryDto): Promise<{
    list: any[];
    totalCount: number;
  }> {
    // 🚀 고성능 검색 엔진(Elasticsearch)으로 전환
    return this.searchService.searchProducts(query);
  }

  /** ✅ 상세 조회 (nullable) */
  async findOne(productId: string): Promise<ProductDetailWithRelations | null> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: {
        store: true,
        category: true,
        stocks: { include: { size: true } },
        reviews: true,
        inquiries: true,
      },
    });

    if (!product) return null;

    return {
      ...product,
      discountRate: product.discountRate ?? 0,
      discountPrice: product.discountPrice ?? product.price,
    };
  }

  /** ✅ 상세 조회 (null 불가, 예외 발생) */
  private async findOneOrThrow(
    productId: string,
  ): Promise<ProductDetailWithRelations> {
    const p = await this.prisma.product.findUniqueOrThrow({
      where: { id: productId },
      include: {
        store: true,
        category: true,
        stocks: { include: { size: true } },
        reviews: true,
        inquiries: true,
      },
    });

    return {
      ...p,
      discountRate: p.discountRate ?? 0,
      discountPrice: p.discountPrice ?? p.price,
    };
  }

  /** ✅ 상품 수정 (update 후 최신 데이터 재조회) */
  async update(
    productId: string,
    data: {
      name?: string;
      content?: string;
      image?: string;
      price?: number;
      discountRate?: number;
      discountPrice?: number;
      discountStartTime?: string;
      discountEndTime?: string;
      categoryId?: string;
      stocks?: TransformedStock[];
    },
  ): Promise<ProductDetailWithRelations> {
    const { stocks, ...safeData } = data;

    await this.prisma.product.update({
      where: { id: productId },
      data: {
        ...safeData,
        stocks: stocks
          ? {
            deleteMany: { productId },
            create: stocks.map((s) => ({
              sizeId: s.sizeId,
              quantity: s.quantity ?? 0,
            })),
          }
          : undefined,
      },
    });

    return this.findOneOrThrow(productId);
  }

  /** ✅ 연관 데이터까지 삭제 */
  async removeWithRelations(productId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.inquiry.deleteMany({ where: { productId } }),
      this.prisma.stock.deleteMany({ where: { productId } }),
      this.prisma.product.delete({ where: { id: productId } }),
    ]);
  }

  /** ✅ 단일 삭제 */
  async remove(productId: string): Promise<void> {
    await this.prisma.product.delete({ where: { id: productId } });
  }

  /** ✅ 상품 문의 등록 */
  async createInquiry(
    productId: string,
    dto: CreateInquiryDto & { userId: string },
  ): Promise<Inquiry> {
    return this.prisma.inquiry.create({
      data: {
        title: dto.title,
        content: dto.content,
        isSecret: dto.isSecret ?? false,
        userId: dto.userId,
        productId,
      },
    });
  }

  /** ✅ 상품 문의 조회 (reply 포함) */
  async findInquiries(
    productId: string,
  ): Promise<{ list: InquiryWithRelations[]; totalCount: number }> {
    const list = await this.prisma.inquiry.findMany({
      where: { productId },
      include: {
        user: true,
        reply: { include: { user: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return { list, totalCount: list.length };
  }

  /** ✅ 상품 리뷰 통계 업데이트 (반정규화 필드 갱신) */
  async updateProductReviewStats(productId: string) {
    const reviews = await this.prisma.review.findMany({
      where: { productId },
      select: { rating: true },
    });

    const reviewCount = reviews.length;
    const avgRating =
      reviewCount > 0
        ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviewCount
        : 0;

    return this.prisma.product.update({
      where: { id: productId },
      data: {
        reviewCount,
        avgRating,
      },
    });
  }
}
