import { z } from "zod";

const ClientEnvSchema = z.object({
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().min(1),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1).optional(),
  NEXT_PUBLIC_SENTRY_DSN: z.string().min(1).optional(),
});

export function clientEnv() {
  const parsed = ClientEnvSchema.safeParse(process.env);
  if (!parsed.success) {
     
    console.error("❌ Invalid client env:", parsed.error.flatten().fieldErrors);
    throw new Error("Invalid client environment variables (see logs).");
  }
  return parsed.data;
}
