import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn) && process.env.NODE_ENV !== "test",

  // Keep this conservative; raise if you want more performance detail.
  tracesSampleRate: 0.1,

  // Avoid noisy local dev capture unless DSN is set.
  debug: false,
});
