import { PrismaClient, CategoryType, UserType } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🚀 대량 상품 데이터 삽입 시작 (1,000,000건)');

  // 1. 필요한 기본 데이터 확인 (Store, Category)
  let store = await prisma.store.findFirst();
  
  if (!store) {
    console.log('⚠️ 스토어가 없습니다. 테스트용 판매자 및 스토어를 생성합니다.');
    
    // 판매자 타입의 사용자가 있는지 확인
    let seller = await prisma.user.findFirst({ where: { type: UserType.SELLER } });
    
    if (!seller) {
      seller = await prisma.user.create({
        data: {
          email: 'test-seller@example.com',
          passwordHash: 'hashed_password_here', // 실제로는 해싱된 값이 들어감
          name: '테스트 판매자',
          type: UserType.SELLER,
        }
      });
    }

    store = await prisma.store.create({
      data: {
        name: '테스트 대규모 스토어',
        address: '서울시 강남구',
        detailAddress: '테스트 빌딩 101호',
        phoneNumber: '010-1234-5678',
        content: '백만 건의 상품을 보유한 테스트 스토어입니다.',
        sellerId: seller.id,
      }
    });
  }

  let category = await prisma.category.findFirst();
  if (!category) {
    console.log('⚠️ 카테고리가 없습니다. TOP 카테고리를 생성합니다.');
    category = await prisma.category.create({
      data: { name: CategoryType.TOP }
    });
  }

  const TOTAL_RECORDS = 1_000_000;
  const BATCH_SIZE = 10_000;
  const TOTAL_BATCHES = TOTAL_RECORDS / BATCH_SIZE;

  const start = Date.now();

  for (let i = 0; i < TOTAL_BATCHES; i++) {
    const products: any[] = []; // 타입을 any로 지정하여 TS 오류 방지 (createMany에 적합한 데이터 구조)
    for (let j = 0; j < BATCH_SIZE; j++) {
      const index = i * BATCH_SIZE + j + 1;
      const price = Math.floor(Math.random() * 100000) + 1000;
      const discountRate = Math.floor(Math.random() * 50);
      const discountPrice = Math.floor(price * (1 - discountRate / 100));

      products.push({
        name: `대용량 테스트 상품 ${index}`,
        content: `이것은 ${index}번째 테스트 상품의 상세 설명입니다.`,
        price: price,
        discountRate: discountRate,
        discountPrice: discountPrice,
        image: 'https://nb02-codiit-team2.s3.ap-northeast-2.amazonaws.com/default-product.png',
        storeId: store.id,
        categoryId: category.id,
        sales: Math.floor(Math.random() * 1000),
      });
    }

    await prisma.product.createMany({
      data: products,
      skipDuplicates: true,
    });

    if ((i + 1) % 10 === 0 || i === TOTAL_BATCHES - 1) {
      const current = Date.now();
      const elapsed = ((current - start) / 1000).toFixed(2);
      const progress = (((i + 1) / TOTAL_BATCHES) * 100).toFixed(1);
      console.log(`✅ [${i + 1}/${TOTAL_BATCHES}] ${progress}% 완료 (${((i + 1) * BATCH_SIZE).toLocaleString()}개) - 소요 시간: ${elapsed}초`);
    }
  }

  const end = Date.now();
  console.log(`\n🎉 총 백만 개의 데이터가 성공적으로 삽입되었습니다!`);
  console.log(`총 소요 시간: ${((end - start) / 1000 / 60).toFixed(2)}분`);
}

main()
  .catch((e) => {
    console.error('❌ 데이터 삽입 중 오류 발생:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
