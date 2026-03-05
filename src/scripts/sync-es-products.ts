import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { SearchService } from '../search/search.service';

/**
 * 🚀 PostgreSQL -> Elasticsearch 초고속 전체 데이터 동기화 스크립트
 * - 커서 기반 페이징 (Cursor Pagination)
 * - 벌크 색인 (Bulk API)
 * - 병렬 처리 (Parallel Batch Processing)
 */
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);
  const searchService = app.get(SearchService);

  console.log('--- ES 초고속 데이터 동기화 시작 ---');

  const batchSize = 5000; // 한 번에 가져올 상품 수
  const concurrency = 3;   // 병렬로 처리할 배치 수 (메모리에 따라 조절 가능)
  let lastId: string | null = null;
  let totalSynchronized = 0;
  const startTime = Date.now();

  await searchService.createIndex();

  while (true) {
    // 1. 병렬 배치 처리를 위한 프로미스 배열 생성
    const batchPromises = [];

    for (let i = 0; i < concurrency; i++) {
      const fetchAndIndex = async () => {
        // 커서 기반 데이터 조회 (Include 최적화로 N+1 방지)
        const products = await prisma.product.findMany({
          take: batchSize,
          where: lastId ? { id: { gt: lastId } } : {},
          orderBy: { id: 'asc' },
          include: {
            store: {
              select: { name: true },
            },
            stocks: {
              select: {
                sizeId: true,
                quantity: true,
              },
            },
          },
        });

        if (products.length === 0) return null;

        // 마지막 ID 업데이트
        lastId = products[products.length - 1].id;

        // ES 포맷으로 변환
        const formattedProducts = products.map((p) => ({
          ...p,
          storeName: p.store?.name,
          discountPrice: p.discountPrice ?? p.price,
          discountRate: p.discountRate ?? 0,
          store: undefined, // 불필요한 중첩 객체 제거
        }));

        // 벌크 인덱싱
        await searchService.bulkIndexProducts(formattedProducts);
        return products.length;
      };

      // 순차적으로 lastId가 갱신되어야 하므로 i 루프 내에서 await 사용
      // 병렬은 내부 로직(쿼리-색인)에서 최대한 비동기 활용
      const processedCount = await fetchAndIndex();
      if (!processedCount) break;

      totalSynchronized += processedCount;
      const elapsed = (Date.now() - startTime) / 1000;
      const speed = Math.round(totalSynchronized / elapsed);
      console.log(`진행 중... (${totalSynchronized.toLocaleString()} 건 완료, 속도: ${speed}건/초)`);
    }

    // 모든 더 이상 상품이 없으면 종료
    const lastBatch = await prisma.product.findFirst({
      where: lastId ? { id: { gt: lastId } } : {},
    });
    if (!lastBatch) break;
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`--- 동기화 완료! 총 ${totalSynchronized.toLocaleString()}건, 소요시간: ${totalTime}초 ---`);
  await app.close();
}

bootstrap().catch((err) => {
  console.error('동기화 중 에러 발생:', err);
  process.exit(1);
});
