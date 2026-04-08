import http from 'k6/http';
import { check, sleep, fail } from 'k6';

/**
 * 🚀 CODIIT 주문 생성 API (Kafka EDA) 부하 테스트 스크립트
 * 
 * [테스트 목적]
 * 1. EDA 도입으로 인해 메인 주문 API 응답 속도(Latency)가 병목 없이 유지되는가?
 * 2. 동시 접속자가 많아져도(TPS) Connection Timeout 없이 요청을 잘 받아내는가?
 * 
 * [실행 방법]
 * k6 run tests/load/create-order.js
 */

export const options = {
  // 💡 유저 수가 아닌 '초당 요청 수(RPS)' 기준으로 테스트 수행
  scenarios: {
    order_load_test: {
      executor: 'ramping-arrival-rate', // 도달률(Arrival Rate) 기반 실행기
      startRate: 10,                 // 시작 RPS
      timeUnit: '1s',
      preAllocatedVUs: 100,          // 초기에 할당할 가상 유저 수
      maxVUs: 100,                  
      stages: [
        { target: 100, duration: '10s' }, 
        { target: 100, duration: '30s' }, 
        { target: 0, duration: '10s' },  
      ], 
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<150'], 
    http_req_failed: ['rate<0.01'],   
  },
};

export function setup() {
  const BASE_URL = 'http://localhost:3001'; 

  // ✅ [Login] 테스트 계정으로 로그인하여 JWT 토큰 획득
  const loginRes = http.post(`${BASE_URL}/api/auth/login`, JSON.stringify({
    email: 'test-buyer@example.com',
    password: 'pass1234',
  }), {
    headers: { 'Content-Type': 'application/json' },
  });

  // 💡 로그인 실패 시 즉시 중단 및 사유 출력
  if (loginRes.status !== 200) {
    fail(`❌ Login Failed! Status: ${loginRes.status}, Body: ${loginRes.body}`);
  }

  const token = loginRes.json('accessToken');
  
  return { 
    baseUrl: BASE_URL, 
    token: token 
  };
}

export default function (data) {
  const url = `${data.baseUrl}/api/orders`; 

  // ✅ [Data] CreateOrderDto 형식에 맞게 페이로드 수정
  const payload = JSON.stringify({
    name: '부하테스트',
    phone: '010-0000-0000',
    address: '서울특별시 강남구',
    orderItems: [
      {
        productId: 'test_product_1_id', 
        sizeId: 'test_size_m_id', // DB에 실재하는 사이즈 ID
        quantity: 1,
      },
    ],
    usePoint: 0,
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      // ✅ [Auth] 획득한 토큰을 Authorization 헤더에 주입
      'Authorization': `Bearer ${data.token}`, 
    },
  };

  // 1. 메인 API 타격!
  const res = http.post(url, payload, params);

  // 💡 [DEBUG] 실패 원인 확인을 위한 로그 (첫 5건의 에러만 출력)
  if (res.status !== 201 && res.status !== 200) {
    if (__ITER < 5) {
      console.error(`❌ Request Failed! Status: ${res.status}, URL: ${url}`);
      console.error(`Response Body: ${res.body}`);
    }
  }

  // 2. 검증 
  check(res, {
    'is status 201 (Created)': (r) => r.status === 201 || r.status === 200, 
    'response time is under 150ms': (r) => r.timings.duration < 150, 
  });

  // 💡 arrival-rate executor에서는 k6가 초당 요청수를 조절하므로 sleep()이 필요 없습니다.
  // sleep(1)이 있으면 유저(VU)가 비효율적으로 점유되어 목표 RPS 달성이 어려워집니다.
}

// K6_WEB_DASHBOARD=true k6 run test/performance/create-order.js