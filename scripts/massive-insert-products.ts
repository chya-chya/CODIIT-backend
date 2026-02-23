import { PrismaClient, CategoryType } from '@prisma/client';

const prisma = new PrismaClient();

const TARGET_COUNT = 10_000_000;
const BATCH_SIZE = 5_000; // 한 번에 처리할 배치 크기

// 간단한 고유 ID 생성기 (CUID 대용)
const generateId = () => Math.random().toString(36).substring(2, 12) + Date.now().toString(36);

const MOCK_DATA = {
  [CategoryType.TOP]: [
    { name: '시그니처 오버핏 라운드 티셔츠', content: '부드러운 면 100% 소재로 제작된 데일리 오버핏 티셔츠입니다.' },
    { name: '스트라이프 릴렉스드 셔츠', content: '깔끔한 스트라이프 패턴이 매력적인 루즈핏 셔츠입니다.' },
    { name: '헤비 코튼 그래픽 후드티', content: '탄탄한 텐션감이 느껴지는 고중량 원단의 그래픽 후드입니다.' },
  ],
  [CategoryType.BOTTOM]: [
    { name: '스트레이트 핏 로우 데님', content: '생지 데님 본연의 매력을 살린 탄탄한 스트레이트 팬츠입니다.' },
    { name: '와이드 터크 밴딩 슬랙스', content: '허리 밴딩 처리로 편안하면서도 스타일리시한 슬랙스입니다.' },
  ],
  [CategoryType.OUTER]: [
    { name: '클래식 원 버튼 울 코트', content: '고급스러운 울 소재감이 느껴지는 미니멀한 울 코트입니다.' },
    { name: '생활 방수 마운틴 파카', content: '가벼운 비와 바람을 막아주는 기능성 소재의 마운틴 파카입니다.' },
  ],
  [CategoryType.DRESS]: [{ name: '플로럴 에이라인 롱 원피스', content: '사랑스러운 플라워 패턴이 돋보이는 롱 원피스입니다.' }],
  [CategoryType.SKIRT]: [{ name: '언밸런스 컷팅 미니스커트', content: '유니크한 밑단 컷팅이 포인트인 미니스커트입니다.' }],
  [CategoryType.SHOES]: [{ name: '베이직 캔버스 로우 스니커즈', content: '어디에나 잘 어울리는 기본적인 캔버스화입니다.' }],
  [CategoryType.ACC]: [{ name: '미러 렌즈 선글라스', content: '트렌디한 디자인의 미러 선글라스입니다.' }],
};

async function main() {
  console.log('🚀 1,000만 건 대규모 데이터 삽입 시작 (이 작업은 수 시간이 소요될 수 있습니다)');
  const start = Date.now();

  const store = await prisma.store.findFirst();
  if (!store) {
     console.error('❌ 스토어가 없습니다. 먼저 realistic-insert-products.ts를 실행해 주세요.');
     return;
  }

  const categories = await prisma.category.findMany();
  const categoryMap = Object.fromEntries(categories.map((c) => [c.name, c.id]));
  const categoryTypes = Object.values(CategoryType);

  const sizes = await prisma.stockSize.findMany();
  if (sizes.length === 0) {
    console.error('❌ 사이즈 데이터가 없습니다.');
    return;
  }

  let currentTotal = await prisma.product.count();
  console.log('📊 현재 상품 수:', currentTotal);

  while (currentTotal < TARGET_COUNT) {
    const batchProducts = [];
    const batchStocks = [];

    for (let j = 0; j < BATCH_SIZE; j++) {
      if (currentTotal + j >= TARGET_COUNT) break;

      const idx = currentTotal + j + 1;
      const randomCategoryType = categoryTypes[Math.floor(Math.random() * categoryTypes.length)];
      const mockList = MOCK_DATA[randomCategoryType];
      const baseMock = mockList[Math.floor(Math.random() * mockList.length)];

      const price = (Math.floor(Math.random() * 15) + 2) * 10000;
      const discountRate = Math.random() > 0.7 ? Math.floor(Math.random() * 30) + 10 : 0;
      const discountPrice = discountRate > 0 ? Math.floor(price * (1 - discountRate / 100)) : price;
      
      const productId = generateId();

      batchProducts.push({
        id: productId,
        name: `${baseMock.name} ${idx}`,
        content: baseMock.content,
        price,
        discountRate,
        discountPrice,
        image: 'https://nb02-codiit-team2.s3.ap-northeast-2.amazonaws.com/default-product.png',
        storeId: store.id,
        categoryId: categoryMap[randomCategoryType],
        sales: Math.floor(Math.random() * 500),
      });

      // 재고 생성 (랜덤 2개 고정하여 DB 부하 최적화)
      const selectedSizes = [sizes[0], sizes[1]]; 
      for (const size of selectedSizes) {
        batchStocks.push({
          id: generateId(),
          productId,
          sizeId: size.id,
          quantity: Math.floor(Math.random() * 100) + 10,
        });
      }
    }

    // 벌크 삽입
    await prisma.$transaction([
      prisma.product.createMany({ data: batchProducts }),
      prisma.stock.createMany({ data: batchStocks }),
    ]);

    currentTotal += BATCH_SIZE;
    const elapsed = (Date.now() - start) / 1000;
    const speed = currentTotal / elapsed;
    const remaining = (TARGET_COUNT - currentTotal) / speed;

    if (currentTotal % 25000 === 0) {
        console.log(`✅ [${currentTotal}/${TARGET_COUNT}] 삽입 완료 (속도: ${speed.toFixed(0)}건/초, 예상 잔여 시간: ${(remaining / 60).toFixed(1)}분)`);
    }
  }

  console.log('\n✨ 1,000만 건 데이터 삽입이 완료되었습니다!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
