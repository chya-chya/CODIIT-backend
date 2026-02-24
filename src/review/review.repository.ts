import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class ReviewRepository {
  constructor(private prisma: PrismaService) { }

  // Review 등록
  createReview(
    userId: string,
    productId: string,
    rating: number,
    content: string,
  ) {
    return this.prisma.review.create({
      data: { userId, productId, rating, content },
      select: {
        id: true,
        rating: true,
        content: true,
        userId: true,
        productId: true,
        createdAt: true,
      },
    });
  }

  // Review 등록 시, Order 존재 여부 확인
  findOrderByCondition(userId: string, productId: string) {
    return this.prisma.order.findFirst({
      where: {
        userId,
        items: {
          some: {
            productId,
          },
        },
      },
    });
  }

  // Review 등록 시, 기존에 작성한 Review 존재 여부 확인
  findReviewByCondition(userId: string, productId: string) {
    return this.prisma.review.findFirst({
      where: {
        userId,
        productId,
      },
    });
  }

  // Review 조회 시, Product 존재 여부 확인
  findProductById(productId: string) {
    return this.prisma.product.findUnique({ where: { id: productId } });
  }

  // Product에 해당하는 Review 목록 조회
  findAllByProductId(
    productId: string,
    query: { limit: number; page: number },
  ) {
    const { limit, page } = query;

    const result = this.prisma.$transaction(async (tx) => {
      const items = await tx.review.findMany({
        where: { productId },
        select: {
          id: true,
          rating: true,
          content: true,
          userId: true,
          createdAt: true,
          user: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: limit || 5,
        skip: (page - 1) * (limit || 5),
      });

      const total = await tx.review.count({
        where: { productId },
      });

      return { items, total };
    });

    return result;
  }

  // Review 단건 조회
  findReviewById(reviewId: string) {
    return this.prisma.review.findUnique({
      where: { id: reviewId },
      select: {
        id: true,
        rating: true,
        content: true,
        userId: true,
        productId: true,
        createdAt: true,
      },
    });
  }

  // Review 수정
  updateReview(
    reviewId: string,
    updateReviewDto: { rating?: number; content?: string },
  ) {
    return this.prisma.review.update({
      where: { id: reviewId },
      data: { ...updateReviewDto },
      select: {
        id: true,
        rating: true,
        content: true,
        userId: true,
        productId: true,
        createdAt: true,
      },
    });
  }

  // Review 삭제
  deleteReview(reviewId: string) {
    return this.prisma.review.delete({
      where: { id: reviewId },
      select: { id: true, content: true, productId: true },
    });
  }
}
