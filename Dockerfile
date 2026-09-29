# ==============================================================================
# Ketner AI — Production Multi-stage Dockerfile
# ==============================================================================

# Stage 1: Dependencies & Build
FROM node:20-alpine AS builder

WORKDIR /app

# Установка зависимостей сборки
RUN apk add --no-cache libc6-compat

# Копируем манифесты пакетов монорепо для максимального кэширования слоёв
COPY package.json package-lock.json ./
COPY apps/mock-api/package.json ./apps/mock-api/
COPY apps/web/package.json ./apps/web/

# Установка всех зависимостей (включая devDependencies для компиляции TS и сборки Vite)
RUN npm ci

# Копируем исходный код монорепо
COPY . .

# Сборка веб-интерфейса Vite и backend API (TypeScript -> dist)
RUN npm run build

# Stage 2: Production Runner
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8787

# Создание непривилегированного пользователя для безопасности
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 ketner

# Копируем зависимости и скомпилированные артефакты
COPY --from=builder --chown=ketner:nodejs /app/package.json /app/package-lock.json ./
COPY --from=builder --chown=ketner:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=ketner:nodejs /app/apps/mock-api/package.json ./apps/mock-api/
COPY --from=builder --chown=ketner:nodejs /app/apps/mock-api/dist ./apps/mock-api/dist
COPY --from=builder --chown=ketner:nodejs /app/apps/mock-api/data ./apps/mock-api/data
COPY --from=builder --chown=ketner:nodejs /app/apps/mock-api/src/db/migrations ./apps/mock-api/src/db/migrations
COPY --from=builder --chown=ketner:nodejs /app/apps/web/dist ./apps/web/dist

USER ketner

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8787/api/health || exit 1

CMD ["node", "apps/mock-api/dist/server.js"]
