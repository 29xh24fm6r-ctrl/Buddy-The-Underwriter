// src/lib/env.ts

type EnvShape = {
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  NODE_ENV?: string;
  // Clerk
  CLERK_SECRET_KEY?: string;
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?: string;
  // OpenAI
  OPENAI_API_KEY?: string;
  // Resend (optional)
  RESEND_API_KEY?: string;
};

function must(name: string, v: string | undefined) {
  if (!v || !v.trim()) {
    throw new Error(
      `ENV_MISSING: ${name}. Set it in Codespaces secrets or .env.local, then restart dev server / rebuild Codespace.`
    );
  }
  return v.trim();
}

function oneOf(
  aName: string,
  a: string | undefined,
  bName: string,
  b: string | undefined
) {
  const av = a?.trim();
  const bv = b?.trim();
  if (!av && !bv) {
    throw new Error(
      `ENV_MISSING: need ${aName} or ${bName} (service role recommended for server routes).`
    );
  }
  return (av || bv)!;
}

function normalizeSupabaseUrl(raw: string) {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(
      `ENV_INVALID: NEXT_PUBLIC_SUPABASE_URL is not a valid URL: "${raw}"`
    );
  }

  // Catch the most common mistake: dashboard URL
  if (u.host.includes("supabase.com") && u.pathname.includes("/dashboard/")) {
    throw new Error(
      `ENV_INVALID: NEXT_PUBLIC_SUPABASE_URL looks like a dashboard URL. Use "https://<project-ref>.supabase.co".`
    );
  }

  return raw.replace(/\/+$/, "");
}

export function requireOpenAIKey() {
  const e = process.env as EnvShape;
  return must("OPENAI_API_KEY", e.OPENAI_API_KEY);
}

export function requireClerkServerKey() {
  const e = process.env as EnvShape;
  return must("CLERK_SECRET_KEY", e.CLERK_SECRET_KEY);
}

export function requireClerkPublishableKey() {
  const e = process.env as EnvShape;
  return must(
    "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    e.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
  );
}

export function getEnv() {
  const e = process.env as EnvShape;

  const supabaseUrl = normalizeSupabaseUrl(
    must("NEXT_PUBLIC_SUPABASE_URL", e.NEXT_PUBLIC_SUPABASE_URL)
  );

  const supabaseKey = oneOf(
    "SUPABASE_SERVICE_ROLE_KEY",
    e.SUPABASE_SERVICE_ROLE_KEY,
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    e.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );

  return {
    supabaseUrl,
    supabaseKey,
    hasServiceRole: Boolean(
      e.SUPABASE_SERVICE_ROLE_KEY &&
        e.SUPABASE_SERVICE_ROLE_KEY.trim()
    ),
    nodeEnv: e.NODE_ENV || "unknown",
    // validated required keys for launch-hardening
    openaiApiKey: must("OPENAI_API_KEY", e.OPENAI_API_KEY),
    clerkSecretKey: must("CLERK_SECRET_KEY", e.CLERK_SECRET_KEY),
    clerkPublishableKey: must(
      "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
      e.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
    ),
    resendApiKey: (e.RESEND_API_KEY || "").trim() || undefined,
  };
}
