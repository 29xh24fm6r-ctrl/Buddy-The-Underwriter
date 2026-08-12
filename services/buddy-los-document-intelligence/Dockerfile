FROM node:20-bookworm-slim AS dependencies
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
COPY src/scripts/copy-pdf-worker.mjs ./src/scripts/copy-pdf-worker.mjs
RUN pnpm install --frozen-lockfile

FROM dependencies AS builder
WORKDIR /app
COPY . .
ARG GIT_COMMIT_SHA=unknown
ENV GIT_COMMIT_SHA=$GIT_COMMIT_SHA
ENV BUDDY_LOS_PROVIDER_ONLY=true
# The shared Next application validates these names while collecting routes.
# Build-only sentinels let the provider image compile without granting it the
# website's Supabase, Clerk, or OpenAI credentials. They are not copied into
# the runtime stage.
RUN NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co \
    SUPABASE_SERVICE_ROLE_KEY=placeholder \
    CLERK_SECRET_KEY=build-placeholder \
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_placeholder \
    OPENAI_API_KEY=sk-placeholder \
    pnpm build

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV HOSTNAME=0.0.0.0
ENV BUDDY_LOS_PROVIDER_ONLY=true
ENV BUDDY_LOS_PROVIDER_ENABLED=false
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
USER node
EXPOSE 8080
CMD ["node", "server.js"]
