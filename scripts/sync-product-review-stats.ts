import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

const BATCH_SIZE = 1000; // 한 번에 처리할 상품 수
const DELAY_MS = 100;    // 배치 사이 지연 시간 (0.1초)
const PROGRESS_FILE = path.join(__dirname, 'migration_progress.txt');

async function main() {
  console.log('🚀 대규모 상품 리뷰 통계 동기화를 시작합니다...');

  // 1. 마지막으로 성공한 커서(ID) 로드 (재개 지원)
  let lastId: string | undefined = undefined;
  if (fs.existsSync(PROGRESS_FILE)) {
    lastId = fs.readFileSync(PROGRESS_FILE, 'utf-8').trim();
    console.log(`🔄 마지막 중단 지점부터 재개합니다. (Last ID: ${lastId})`);
  }

  let totalProcessed = 0;
  const startTime = Date.now();

  while (true) {
    // 2. 커서 기반 페이징으로 상품 목록 조회
    const products = await prisma.product.findMany({
      take: BATCH_SIZE,
      skip: lastId ? 1 : 0, // lastId가 있으면 그 다음 레코드부터
      cursor: lastId ? { id: lastId } : undefined,
      select: { id: true },
      orderBy: { id: 'asc' },
    });

    if (products.length === 0) break;

    // 3. 배치 내 개별 상품의 통계 계산 및 업데이트 (순차적 처리로 DB 커넥션 부하 조절)
    for (const product of products) {
      const stats = await prisma.review.aggregate({
        where: { productId: product.id },
        _count: { _all: true },
        _avg: { rating: true },
      });

      const reviewCount = stats._count._all;
      const avgRating = stats._avg.rating || 0;

      await prisma.product.update({
        where: { id: product.id },
        data: {
          reviewCount,
          avgRating,
        },
      });

      lastId = product.id;
      totalProcessed++;
    }

    // 4. 진행 상황 로깅 및 상태 저장
    const elapsedMinutes = (Date.now() - startTime) / 60000;
    const speed = (totalProcessed / elapsedMinutes).toFixed(2);
    console.log(`📦 처리 중: ${totalProcessed}개 완료... (속도: ${speed} items/min, Current ID: ${lastId})`);
    
    // 비상 시 재개를 위해 매 배치마다 파일 저장
    if (lastId) fs.writeFileSync(PROGRESS_FILE, lastId, 'utf-8');

    // 5. Throttling: DB 부하 분산
    if (DELAY_MS > 0) await new Promise(resolve => setTimeout(resolve, DELAY_MS));
  }

  const finalTime = ((Date.now() - startTime) / 60000).toFixed(2);
  console.log(`✅ 모든 동기화가 완료되었습니다! (총 ${totalProcessed}개, 소요 시간: ${finalTime}분)`);
  
  // 성공 시 진행 파일 삭제
  if (fs.existsSync(PROGRESS_FILE)) fs.unlinkSync(PROGRESS_FILE);
}

main()
  .catch((e) => {
    console.error('❌ 작업 중 오류가 발생했습니다:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
