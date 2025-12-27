import { z } from "zod";

const ServerEnvSchema = z.object({
  // Clerk (server)
  CLERK_SECRET_KEY: z.string().min(1),

  // Public (safe but required)
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().min(1),

  // Supabase (server)
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),

  // Supabase (public, if you use anon on client)
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1).optional(),

  // OpenAI
  OPENAI_API_KEY: z.string().min(1),

  // Resend (DO NOT change your values; we just validate if present/needed)
  RESEND_API_KEY: z.string().min(1).optional(),

  // Optional observability
  SENTRY_DSN: z.string().min(1).optional(),
  NEXT_PUBLIC_SENTRY_DSN: z.string().min(1).optional(),

  // App
  NODE_ENV: z.enum(["development", "test", "production"]).optional(),
});

export function serverEnv() {
  const parsed = ServerEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error("❌ Invalid server env:", parsed.error.flatten().fieldErrors);
    throw new Error("Invalid server environment variables (see logs).");
  }
  return parsed.data;
}
