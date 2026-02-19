# builder
FROM node:22-alpine AS builder

WORKDIR /app

RUN apk add --no-cache openssl libc6-compat

COPY package*.json ./
COPY prisma ./prisma

# devDeps 포함 설치
RUN npm ci

# Prisma Client 생성
RUN npx prisma generate

# 앱 소스 복사 후 빌드
COPY . .
RUN npm run build


# runner
FROM node:22-alpine AS runner
WORKDIR /app

RUN apk add --no-cache openssl libc6-compat

ENV NODE_ENV=production
ENV PORT=3000

# 프로덕션 의존성
COPY package*.json ./
RUN npm ci --omit=dev

# Prisma 런타임 파일, 빌드 산출물만 복사
COPY --from=builder /app/node_modules/.prisma /app/node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma /app/node_modules/@prisma
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/dist ./dist

EXPOSE 3000

CMD ["node", "dist/src/main.js"]
