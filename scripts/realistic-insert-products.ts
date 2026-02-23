import { PrismaClient, CategoryType, UserType } from '@prisma/client';

const prisma = new PrismaClient();

const DATA_COUNT = 100;

const MOCK_DATA = {
  [CategoryType.TOP]: [
    { name: '시그니처 오버핏 라운드 티셔츠', content: '부드러운 면 100% 소재로 제작된 데일리 오버핏 티셔츠입니다.' },
    { name: '스트라이프 릴렉스드 셔츠', content: '깔끔한 스트라이프 패턴이 매력적인 루즈핏 셔츠입니다. 오피스룩이나 캐주얼한 매치가 가능합니다.' },
    { name: '헤비 코튼 그래픽 후드티', content: '탄탄한 텐션감이 느껴지는 고중량 원단의 그래픽 후드 조업입니다.' },
    { name: '프리미엄 린넨 헨리넥 셔츠', content: '여름철 시원하게 착용 가능한 프리미엄 린넨 소재의 셔츠입니다.' },
  ],
  [CategoryType.BOTTOM]: [
    { name: '스트레이트 핏 로우 데님', content: '생지 데님 본연의 매력을 살린 탄탄한 스트레이트 공법의 팬츠입니다.' },
    { name: '와이드 터크 밴딩 슬랙스', content: '허리 밴딩 처리로 편안하면서도 스타일리시한 와이드 핏 슬랙스입니다.' },
    { name: '슬림 테이퍼드 치노 팬츠', content: '다리가 길어 보이는 실루엣의 깔끔한 치노 팬츠입니다.' },
  ],
  [CategoryType.OUTER]: [
    { name: '클래식 원 버튼 울 코트', content: '고급스러운 울 소재감이 느껴지는 미니멀한 실루엣의 울 코트입니다.' },
    { name: '생활 방수 마운틴 파카', content: '가벼운 비와 바람을 막아주는 기능성 소재의 고퀄리티 마운틴 파카입니다.' },
    { name: '워싱 오버사이즈 데님 자켓', content: '빈티지한 워싱감이 특징인 트렌디한 오버사이즈 자켓입니다.' },
  ],
  [CategoryType.DRESS]: [
    { name: '플로럴 에이라인 롱 원피스', content: '사랑스러운 플라워 패턴이 돋보이는 페미닌한 무드의 롱 원피스입니다.' },
    { name: '캐시미어 블렌딩 니트 원피스', content: '따뜻하고 부드러운 촉감의 캐시미어 혼방 니트 원피스입니다.' },
  ],
  [CategoryType.SKIRT]: [
    { name: '언밸런스 컷팅 미니스커트', content: '유니크한 밑단 컷팅이 포인트인 미니멀한 기장감의 스커트입니다.' },
    { name: '에이치라인 데님 미디 스커트', content: '다양한 상의와 매치하기 좋은 베이직한 H라인 실루엣의 데님 스커트입니다.' },
  ],
  [CategoryType.SHOES]: [
    { name: '베이직 캔버스 로우 스니커즈', content: '어디에나 잘 어울리는 가장 기본적인 디자인의 캔버스화입니다.' },
    { name: '리얼 레더 첼시 부츠', content: '은은한 광택감이 감도는 고품질 천연 소가죽 소재의 첼시 부츠입니다.' },
  ],
  [CategoryType.ACC]: [
    { name: '미러 렌즈 선글라스', content: '여름철 필수 아이템, 트렌디한 디자인의 미러 선글라스입니다.' },
    { name: '데일리 가죽 미니 숄더백', content: '콤팩트한 사이즈로 실용적이며 세련된 미니 백입니다.' },
  ],
};

async function main() {
  console.log('🌈 실제와 유사한 상품 데이터 생성 시작 (100건)');

  // 1. 기초 데이터 (판매자, 스토어)
  let store = await prisma.store.findFirst();
  if (!store) {
    let seller = await prisma.user.findFirst({ where: { type: UserType.SELLER } });
    if (!seller) {
      seller = await prisma.user.create({
        data: {
          email: 'brand-seller@example.com',
          passwordHash: 'hashed',
          name: '브랜드 공식 판매자',
          type: UserType.SELLER,
        },
      });
    }
    store = await prisma.store.create({
      data: {
        name: 'CODIIT 공식 셀렉샵',
        address: '서울시 성동구 성수동',
        detailAddress: '아뜰리에 빌딩 3F',
        phoneNumber: '070-1234-5678',
        content: '트렌디한 패션 아이템을 큐레이션하여 선보이는 공식 셀렉샵입니다.',
        sellerId: seller.id,
      },
    });
  }

  // 2. 카테고리 확보
  const categories = await Promise.all(
    Object.values(CategoryType).map((name) =>
      prisma.category.upsert({
        where: { name },
        update: {},
        create: { name },
      })
    )
  );
  const categoryMap = Object.fromEntries(categories.map((c) => [c.name, c.id]));

  // 3. 사이즈 정보 확보
  const sizeNames = ['XS', 'S', 'M', 'L', 'XL', 'FREE'];
  const sizes = await Promise.all(
    sizeNames.map((name) =>
      prisma.stockSize.upsert({
        where: { id: `size_${name.toLowerCase()}` }, // 임의 ID 지정하거나 findOrCreate
        update: {},
        create: { id: `size_${name.toLowerCase()}`, name },
      }).catch(() => prisma.stockSize.findFirst({ where: { name } }))
    )
  );
  const validSizes = sizes.filter(Boolean) as any[];

  // 4. 데이터 생성 루프
  for (let i = 0; i < DATA_COUNT; i++) {
    const categoryTypes = Object.values(CategoryType);
    const randomCategoryType = categoryTypes[Math.floor(Math.random() * categoryTypes.length)];
    const mockList = MOCK_DATA[randomCategoryType];
    const baseMock = mockList[Math.floor(Math.random() * mockList.length)];

    const price = (Math.floor(Math.random() * 15) + 2) * 10000; // 2만원 ~ 16만원
    const discountRate = Math.random() > 0.7 ? Math.floor(Math.random() * 30) + 10 : 0;
    const discountPrice = discountRate > 0 ? Math.floor(price * (1 - discountRate / 100)) : price;

    const product = await prisma.product.create({
      data: {
        name: `${baseMock.name} ${i + 1}`,
        content: baseMock.content,
        price,
        discountRate,
        discountPrice,
        image: `https://nb02-codiit-team2.s3.ap-northeast-2.amazonaws.com/default-product.png`,
        storeId: store.id,
        categoryId: categoryMap[randomCategoryType],
        sales: Math.floor(Math.random() * 500),
      },
    });

    // 재고 생성 (랜덤하게 2~4개 사이즈 선택)
    const shuffledSizes = [...validSizes].sort(() => 0.5 - Math.random());
    const selectedSizes = shuffledSizes.slice(0, Math.floor(Math.random() * 3) + 2);

    await Promise.all(
      selectedSizes.map((size) =>
        prisma.stock.create({
          data: {
            productId: product.id,
            sizeId: size.id,
            quantity: Math.floor(Math.random() * 100) + 10,
          },
        })
      )
    );

    if ((i + 1) % 20 === 0) {
      console.log(`✅ [${i + 1}/100] 상품 및 재고 데이터 삽입 완료`);
    }
  }

  console.log('\n✨ 실제와 유사한 고퀄리티 테스트 데이터 100건 삽입이 완료되었습니다!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
