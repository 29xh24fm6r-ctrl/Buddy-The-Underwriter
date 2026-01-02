import { NextResponse } from "next/server";
import { clerkAuth, clerkCurrentUser } from "@/lib/auth/clerkServer";
import { SignJWT } from "jose";
import { createClient } from "@supabase/supabase-js";

function getEnv(name: string) {
  const v = process.env[name];
  return v && v.trim().length ? v : null;
}

function redact(v: string | null) {
  if (!v) return null;
  return `***${v.slice(-6)}`;
}

/**
 * Token Exchange: Clerk → Supabase JWT
 *
 * 1) Verify Clerk session
 * 2) Upsert public.app_users by clerk_user_id
 * 3) Mint Supabase JWT with sub = app_users.id (uuid) so RLS auth.uid() works
 */
export async function GET() {
  try {
    const { userId: clerkUserId } = await clerkAuth();
    if (!clerkUserId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const user = await clerkCurrentUser();
    const email = user?.emailAddresses?.[0]?.emailAddress ?? null;

    const SUPABASE_URL = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const SUPABASE_JWT_SECRET = getEnv("SUPABASE_JWT_SECRET");

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_JWT_SECRET) {
      return NextResponse.json(
        {
          error: "missing_env",
          missing: {
            NEXT_PUBLIC_SUPABASE_URL: !SUPABASE_URL,
            SUPABASE_SERVICE_ROLE_KEY: !SUPABASE_SERVICE_ROLE_KEY,
            SUPABASE_JWT_SECRET: !SUPABASE_JWT_SECRET,
          },
          present_suffixes: {
            NEXT_PUBLIC_SUPABASE_URL: redact(SUPABASE_URL),
            SUPABASE_SERVICE_ROLE_KEY: redact(SUPABASE_SERVICE_ROLE_KEY),
            SUPABASE_JWT_SECRET: redact(SUPABASE_JWT_SECRET),
          },
        },
        { status: 500 }
      );
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const { data: upserted, error: upsertErr } = await supabaseAdmin
      .from("app_users")
      .upsert({ clerk_user_id: clerkUserId, email }, { onConflict: "clerk_user_id" })
      .select("id")
      .single();

    if (upsertErr || !upserted?.id) {
      return NextResponse.json(
        {
          error: "failed_to_upsert_app_user",
          message: upsertErr?.message ?? "unknown",
          code: (upsertErr as any)?.code ?? null,
          hint: (upsertErr as any)?.hint ?? null,
        },
        { status: 500 }
      );
    }

    const buddyUserId = upserted.id as string;

    const secret = new TextEncoder().encode(SUPABASE_JWT_SECRET);

    const jwt = await new SignJWT({
      role: "authenticated",
      app_user_id: buddyUserId,
      clerk_user_id: clerkUserId,
      email,
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(buddyUserId)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(secret);

    return NextResponse.json({ token: jwt, buddyUserId });
  } catch (e: any) {
    return NextResponse.json(
      { error: "unhandled_exception", message: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
