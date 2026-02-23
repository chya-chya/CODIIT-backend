import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001/api/products';

// 각 정렬별 개별 지표 정의
const trends = {
  highRating: new Trend('lat_highRating'),
  mostReviewed: new Trend('lat_mostReviewed'),
  highPrice: new Trend('lat_highPrice'),
  lowPrice: new Trend('lat_lowPrice'),
  recent: new Trend('lat_recent'),
  salesRanking: new Trend('lat_salesRanking'),
};

// 각 정렬 기준별 시나리오 설정
export const options = {
  scenarios: {
    highRating: {
      executor: 'constant-vus',
      vus: 5,
      duration: '20s',
      exec: 'testHighRating',
    },
    mostReviewed: {
      executor: 'constant-vus',
      vus: 5,
      duration: '20s',
      exec: 'testMostReviewed',
      startTime: '25s',
    },
    highPrice: {
      executor: 'constant-vus',
      vus: 5,
      duration: '20s',
      exec: 'testHighPrice',
      startTime: '50s',
    },
    lowPrice: {
      executor: 'constant-vus',
      vus: 5,
      duration: '20s',
      exec: 'testLowPrice',
      startTime: '75s',
    },
    recent: {
      executor: 'constant-vus',
      vus: 5,
      duration: '20s',
      exec: 'testRecent',
      startTime: '100s',
    },
    salesRanking: {
      executor: 'constant-vus',
      vus: 5,
      duration: '20s',
      exec: 'testSalesRanking',
      startTime: '125s',
    },
  },
  thresholds: {
    'http_req_duration': ['p(95)<500'],
  },
};

// --- 요청 함수 정의 ---

export function testHighRating() {
  const res = http.get(`${BASE_URL}?sort=highRating&pageSize=16`);
  trends.highRating.add(res.timings.duration);
  check(res, { 'status is 200': (r) => r.status === 200 });
  sleep(1);
}

export function testMostReviewed() {
  const res = http.get(`${BASE_URL}?sort=mostReviewed&pageSize=16`);
  trends.mostReviewed.add(res.timings.duration);
  check(res, { 'status is 200': (r) => r.status === 200 });
  sleep(1);
}

export function testHighPrice() {
  const res = http.get(`${BASE_URL}?sort=highPrice&pageSize=16`);
  trends.highPrice.add(res.timings.duration);
  check(res, { 'status is 200': (r) => r.status === 200 });
  sleep(1);
}

export function testLowPrice() {
  const res = http.get(`${BASE_URL}?sort=lowPrice&pageSize=16`);
  trends.lowPrice.add(res.timings.duration);
  check(res, { 'status is 200': (r) => r.status === 200 });
  sleep(1);
}

export function testRecent() {
  const res = http.get(`${BASE_URL}?sort=recent&pageSize=16`);
  trends.recent.add(res.timings.duration);
  check(res, { 'status is 200': (r) => r.status === 200 });
  sleep(1);
}

export function testSalesRanking() {
  const res = http.get(`${BASE_URL}?sort=salesRanking&pageSize=16`);
  trends.salesRanking.add(res.timings.duration);
  check(res, { 'status is 200': (r) => r.status === 200 });
  sleep(1);
}

//K6_WEB_DASHBOARD=true K6 run test/performance/products-sort.js   