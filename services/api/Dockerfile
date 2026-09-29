# =====================================================
# Node.js + TypeScript API Service
# Build context: monorepo root (./)
# =====================================================
FROM node:20-alpine AS deps
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/contracts/package.json ./packages/contracts/
COPY services/api/package.json ./services/api/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
  pnpm install --prod --frozen-lockfile --filter @shoot-the-ball/api...

FROM node:20-alpine AS builder
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/contracts ./packages/contracts
COPY services/api/package.json ./services/api/
COPY services/api/prisma ./services/api/prisma

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
  pnpm install --frozen-lockfile --filter @shoot-the-ball/api...

COPY packages/contracts/tsconfig*.json ./packages/contracts/
COPY packages/contracts/src ./packages/contracts/src
COPY services/api/tsconfig*.json ./services/api/
COPY services/api/src ./services/api/src

RUN pnpm --filter @shoot-the-ball/contracts run build \
  && cd services/api \
  && pnpm db:generate \
  && pnpm build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nestjs

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/services/api/dist ./services/api/dist
COPY --from=builder /app/services/api/package.json ./services/api/package.json
COPY --from=builder /app/services/api/prisma ./services/api/prisma
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-workspace.yaml ./pnpm-workspace.yaml

WORKDIR /app/services/api
USER nestjs
EXPOSE 4321
CMD ["node", "dist/main.js"]
