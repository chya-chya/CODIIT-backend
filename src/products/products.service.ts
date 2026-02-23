import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ProductsRepository } from './products.repository';
import {
  CreateProductDto,
  CreateStockDto,
  TransformedStock,
} from './dto/create-product.dto';
import { UpdateProductDto, UpdateStockDto } from './dto/update-product.dto';
import { FindProductsQueryDto } from './dto/find-products-query.dto';
import { CreateInquiryDto } from './dto/create-inquiry.dto';
import {
  Product,
  Inquiry,
  AnswerStatus,
  Stock,
  Category,
  CategoryType,
} from '@prisma/client';
import type { InquiryWithRelations } from '../types/inquiry-with-relations.type';

export type ProductListResponse = {
  list: Array<{
    id: string;
    storeId: string;
    storeName: string;
    name: string;
    image: string | null;
    price: number;
    discountPrice: number;
    discountRate: number;
    discountStartTime: Date | null;
    discountEndTime: Date | null;
    reviewsCount: number;
    reviewsRating: number;
    createdAt: Date;
    updatedAt: Date;
    sales: number;
    isSoldOut: boolean;
  }>;
  totalCount: number;
};

export type ProductResponse = {
  id: string;
  storeId: string;
  storeName: string;
  content: string | null;
  name: string;
  image: string | null;
  price: number;
  discountPrice: number;
  discountRate: number;
  discountStartTime: Date | null;
  discountEndTime: Date | null;
  reviewsCount: number;
  reviewsRating: number;
  createdAt: Date;
  updatedAt: Date;
  sales: number;
  isSoldOut: boolean;
  reviews: {
    rate1Length: number;
    rate2Length: number;
    rate3Length: number;
    rate4Length: number;
    rate5Length: number;
    sumScore: number;
  };
  inquiries: Inquiry[];
  category: Category;
  stocks: Stock[];
};

export interface ProductWithStore extends Product {
  store: {
    id: string;
    name: string;
    sellerId: string;
    content: string;
    image: string | null;
    createdAt: Date;
    updatedAt: Date;
    address: string;
    detailAddress: string;
    phoneNumber: string;
  };
}

export type InquiryResponse = {
  list: InquiryWithRelations[];
  totalCount: number;
};

@Injectable()
export class ProductsService {
  constructor(private readonly productsRepository: ProductsRepository) {}

  /** 🔧 stocks 변환 (프론트 숫자 사이즈 대응 버전) */
  private async transformStocks(
    stocks: (CreateStockDto | UpdateStockDto)[],
  ): Promise<TransformedStock[]> {
    // ✅ 허용된 사이즈 목록 (대문자 기준)
    const allowedSizes = ['XS', 'S', 'M', 'L', 'XL', 'FREE'];

    // ✅ 프론트에서 오는 숫자 → 사이즈 이름 매핑
    const sizeIdMap: Record<string, string> = {
      '1': 'XS',
      '2': 'S',
      '3': 'M',
      '4': 'L',
      '5': 'XL',
      '6': 'FREE',
    };

    return Promise.all(
      stocks.map(async (stock) => {
        if (!stock.sizeId) {
          throw new NotFoundException('사이즈 ID가 필요합니다.');
        }

        // ✅ 1) ID로 먼저 조회 (문자열 변환 포함)
        const size = await this.productsRepository.findStockSizeById(
          String(stock.sizeId),
        );

        if (size) {
          // ✅ 존재하면 그대로 사용
          return { sizeId: size.id, quantity: stock.quantity ?? 0 };
        }

        // ✅ 2) 숫자 ID를 이름으로 매핑 (프론트가 보낸 값)
        const maybeMappedName = sizeIdMap[String(stock.sizeId)];
        const maybeSizeName = maybeMappedName
          ? maybeMappedName
          : String(stock.sizeId).toUpperCase();

        // ✅ 유효한 사이즈인지 검증
        if (!allowedSizes.includes(maybeSizeName)) {
          throw new NotFoundException(
            `허용되지 않은 사이즈입니다: ${stock.sizeId}`,
          );
        }

        // ✅ DB에 없으면 새로 생성
        const created = await this.productsRepository.createStockSize({
          name: maybeSizeName,
        });

        return { sizeId: created.id, quantity: stock.quantity ?? 0 };
      }),
    );
  }

  /** ✅ 상품 등록 */
  async create(
    dto: CreateProductDto,
    sellerId: string,
  ): Promise<ProductResponse> {
    try {
      const { price, discountRate, categoryName, categoryId } = dto;

      // ✅ 스토어 확인
      const store = await this.productsRepository.findStoreBySellerId(sellerId);
      if (!store) throw new NotFoundException('스토어를 찾을 수 없습니다.');

      // ✅ 카테고리 확인 (seed 불필요, enum 기반 자동 생성)
      let resolvedCategoryId: string;

      if (categoryId) {
        resolvedCategoryId = categoryId;
      } else if (categoryName) {
        const resolvedCategoryName = (
          typeof categoryName === 'object'
            ? (categoryName as Category).name
            : categoryName.toUpperCase()
        ) as CategoryType;

        // 유효한 enum 값인지 검증
        const isValidCategory =
          Object.values(CategoryType).includes(resolvedCategoryName);
        if (!isValidCategory) {
          throw new NotFoundException(
            `유효하지 않은 카테고리: ${categoryName}`,
          );
        }

        // DB에 존재하지 않으면 자동 생성
        const category =
          await this.productsRepository.upsertCategory(resolvedCategoryName);

        resolvedCategoryId = category.id;
      } else {
        // ③ categoryId나 categoryName 둘 다 없으면 예외
        throw new NotFoundException('카테고리 정보가 없습니다.');
      }

      // ✅ 할인 가격 계산 (기본값 포함)
      const discountPrice =
        discountRate !== undefined && discountRate > 0
          ? Math.floor(price * (1 - discountRate / 100))
          : price;

      // ✅ 사이즈 변환
      const stocks = dto.stocks ? await this.transformStocks(dto.stocks) : [];

      // ✅ DB 저장
      const product = await this.productsRepository.create({
        name: dto.name,
        content: dto.content,
        image: dto.image,
        price: dto.price,
        discountRate: dto.discountRate ?? 0,
        discountPrice,
        discountStartTime: dto.discountStartTime,
        discountEndTime: dto.discountEndTime,
        storeId: store.id,
        categoryId: resolvedCategoryId,
        stocks,
      });

      return this.findOne(product.id);
    } catch (err: unknown) {
      if (
        err instanceof NotFoundException ||
        err instanceof ForbiddenException
      ) {
        throw err;
      }
      const safeErr = err as Record<string, unknown>;
      throw new InternalServerErrorException(
        typeof safeErr.message === 'string'
          ? safeErr.message
          : '상품 등록 중 오류가 발생했습니다.',
      );
    }
  }

  /** ✅ 상품 목록 조회 */
  async findAll(query: FindProductsQueryDto): Promise<ProductListResponse> {
    const { list: products, totalCount } =
      await this.productsRepository.findAll(query);

    const list = products.map((product) => {
      const reviewsRating =
        product.reviews.length > 0
          ? product.reviews.reduce((sum, r) => sum + r.rating, 0) /
            product.reviews.length
          : 0;

      return {
        id: product.id,
        storeId: product.storeId,
        storeName: product.store?.name,
        name: product.name,
        image: product.image,
        content: product.content,
        price: product.price,
        discountPrice: product.discountPrice ?? product.price,
        discountRate: product.discountRate ?? 0,
        discountStartTime: product.discountStartTime,
        discountEndTime: product.discountEndTime,
        reviewsCount: product.reviews.length,
        reviewsRating,
        createdAt: product.createdAt,
        updatedAt: product.updatedAt,
        sales: product.sales,
        isSoldOut: !product.stocks?.some((s) => s.quantity > 0),
      };
    });
    if (query.sort === 'highRating') {
      list.sort((a, b) => b.reviewsRating - a.reviewsRating);
    }

    return { list, totalCount };
  }

  /** 상품 상세 조회 */
  async findOne(productId: string): Promise<ProductResponse> {
    const product = await this.productsRepository.findOne(productId);
    if (!product) throw new NotFoundException('상품을 찾을 수 없습니다.');

    const reviewsRating =
      product.reviews.length > 0
        ? product.reviews.reduce((sum, r) => sum + r.rating, 0) /
          product.reviews.length
        : 0;

    const reviews = {
      rate1Length: product.reviews.filter((review) => review.rating === 1)
        .length,
      rate2Length: product.reviews.filter((review) => review.rating === 2)
        .length,
      rate3Length: product.reviews.filter((review) => review.rating === 3)
        .length,
      rate4Length: product.reviews.filter((review) => review.rating === 4)
        .length,
      rate5Length: product.reviews.filter((review) => review.rating === 5)
        .length,
      // 평균 별점
      sumScore: product.reviews.reduce(
        (sum, review) => sum + review.rating / product.reviews.length,
        0,
      ),
    };

    return {
      id: product.id,
      storeId: product.storeId,
      storeName: product.store?.name,
      name: product.name,
      content: product.content,
      image: product.image,
      price: product.price,
      discountPrice: product.discountPrice ?? product.price,
      discountRate: product.discountRate ?? 0,
      discountStartTime: product.discountStartTime,
      discountEndTime: product.discountEndTime,
      reviewsCount: product.reviews.length,
      reviewsRating,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
      sales: product.sales,
      isSoldOut: !product.stocks?.some((s) => s.quantity > 0),
      reviews,
      inquiries: product.inquiries,
      category: product.category,
      stocks: product.stocks,
    };
  }

  /** ✅ 상품 수정 (category 자동 생성 포함) */
  async update(
    productId: string,
    dto: UpdateProductDto,
    sellerId: string,
  ): Promise<ProductResponse> {
    try {
      const product = await this.productsRepository.findOne(productId);
      if (!product) throw new NotFoundException('상품을 찾을 수 없습니다.');

      const store = await this.productsRepository.findStoreBySellerId(sellerId);
      if (!store || store.id !== product.storeId) {
        throw new ForbiddenException('이 상품을 수정할 권한이 없습니다.');
      }

      // ✅ category 처리
      let resolvedCategoryId: string | undefined;

      if (dto.categoryId) {
        // categoryId를 enum name으로 취급
        const categoryName = dto.categoryId.toUpperCase() as CategoryType;
        const isValidCategory =
          Object.values(CategoryType).includes(categoryName);
        if (!isValidCategory) {
          throw new NotFoundException(
            `유효하지 않은 카테고리: ${dto.categoryId}`,
          );
        }
        const category =
          await this.productsRepository.findCategoryByName(categoryName);
        if (!category)
          throw new NotFoundException('카테고리를 찾을 수 없습니다.');
        resolvedCategoryId = category.id;
      } else if (dto.categoryName) {
        const resolvedCategoryName = (
          typeof dto.categoryName === 'object'
            ? (dto.categoryName as Category).name
            : String(dto.categoryName).toUpperCase()
        ) as CategoryType;

        const isValidCategory =
          Object.values(CategoryType).includes(resolvedCategoryName);
        if (!isValidCategory) {
          throw new NotFoundException(
            `유효하지 않은 카테고리: ${dto.categoryName}`,
          );
        }
        const category =
          await this.productsRepository.upsertCategory(resolvedCategoryName);
        resolvedCategoryId = category.id;
      }

      // ✅ Prisma에 넘기기 전 categoryName, isSoldOut 제거
      const { price, discountRate, stocks, isSoldOut, ...restDto } = dto;

      // restDto를 Record<string, unknown>으로 선언해 안전하게 캐스팅
      const safeRestDto: Record<string, unknown> = { ...restDto };

      // 타입 안전하게 삭제
      delete safeRestDto.categoryName;

      // ✅ 할인 계산
      const discountPrice =
        discountRate !== undefined && discountRate > 0
          ? Math.floor((price ?? product.price) * (1 - discountRate / 100))
          : (price ?? product.price);

      // ✅ 최종 업데이트
      await this.productsRepository.update(productId, {
        ...safeRestDto,
        price,
        discountRate,
        discountPrice,
        ...(resolvedCategoryId && { categoryId: resolvedCategoryId }),
        ...(stocks && { stocks: await this.transformStocks(stocks) }),
      });

      // ✅ isSoldOut이 true인 경우 모든 재고를 0으로 설정
      if (isSoldOut === true) {
        const currentProduct = await this.productsRepository.findOne(productId);
        if (currentProduct && currentProduct.stocks) {
          const zeroStocks = currentProduct.stocks.map((s) => ({
            sizeId: s.sizeId,
            quantity: 0,
          }));
          await this.productsRepository.update(productId, {
            stocks: zeroStocks,
          });
        }
      }

      return this.findOne(productId);
    } catch (err: unknown) {
      if (
        err instanceof NotFoundException ||
        err instanceof ForbiddenException
      ) {
        throw err;
      }
      const safeErr = err as Record<string, unknown>;
      throw new InternalServerErrorException(
        typeof safeErr.message === 'string'
          ? safeErr.message
          : '상품 수정 중 오류가 발생했습니다.',
      );
    }
  }

  /** ✅ 상품 삭제 */
  async remove(productId: string, sellerId: string): Promise<void> {
    const product = await this.productsRepository.findOne(productId);
    if (!product) throw new NotFoundException('상품을 찾을 수 없습니다.');

    const store = await this.productsRepository.findStoreBySellerId(sellerId);
    if (!store || store.id !== product.storeId) {
      throw new ForbiddenException('이 상품을 삭제할 권한이 없습니다.');
    }

    await this.productsRepository.removeWithRelations(productId);
  }

  /** ✅ 상품 문의 등록 */
  async createInquiry(
    productId: string,
    dto: CreateInquiryDto,
    userId: string,
  ): Promise<Inquiry> {
    const product = await this.productsRepository.findOne(productId);
    if (!product) throw new NotFoundException('상품을 찾을 수 없습니다.');

    return this.productsRepository.createInquiry(productId, {
      ...dto,
      userId,
    });
  }

  /** ✅ 상품 문의 조회 */
  async findInquiries(
    productId: string,
    userId: string,
  ): Promise<InquiryResponse> {
    const product = (await this.productsRepository.findOne(
      productId,
    )) as ProductWithStore | null;
    if (!product) throw new NotFoundException('상품을 찾을 수 없습니다.');

    // ✅ 명시적 타입 지정 (ESLint no-unsafe-assignment 방지)
    const { list, totalCount } =
      await this.productsRepository.findInquiries(productId);

    const transformedList: InquiryWithRelations[] = list.map((inq) => {
      // ✅ 비밀글 접근 권한 확인
      if (inq.isSecret) {
        const isOwner = inq.userId === userId;
        const isSeller = product.store.sellerId === userId;
        if (!isOwner && !isSeller) {
          return {
            id: inq.id,
            title: '비밀 문의',
            content: '비밀문의\n',
            status: inq.status ?? AnswerStatus.WaitingAnswer,
            isSecret: inq.isSecret ?? false,
            createdAt: inq.createdAt,
            updatedAt: inq.updatedAt,
            userId: inq.userId,
            productId: inq.productId,
            user: {
              id: inq.user.id,
              name: inq.user.name,
            },
            reply: null, // 답변도 비공개
          };
        }
      }

      // ✅ reply: 단일 객체 또는 null
      return {
        id: inq.id,
        title: inq.title ?? '',
        content: inq.content,
        status: inq.status ?? AnswerStatus.WaitingAnswer,
        isSecret: inq.isSecret ?? false,
        createdAt: inq.createdAt,
        updatedAt: inq.updatedAt,
        userId: inq.userId,
        productId: inq.productId,
        user: inq.user,
        reply: inq.reply
          ? {
              id: inq.reply.id,
              content: inq.reply.content,
              createdAt: inq.reply.createdAt,
              updatedAt: inq.reply.updatedAt,
              user: {
                id: inq.reply.user.id,
                name: inq.reply.user.name,
              },
            }
          : null,
      };
    });

    return { list: transformedList, totalCount };
  }
}
