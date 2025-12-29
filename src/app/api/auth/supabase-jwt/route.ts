import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { SignJWT } from "jose";
import { createClient } from "@supabase/supabase-js";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

/**
 * Token Exchange: Clerk → Supabase JWT
 * 
 * This route verifies Clerk authentication, then:
 * 1. Upserts app_users by clerk_user_id
 * 2. Signs a Supabase JWT with sub = app_users.id
 * 3. Returns it to the client so RLS auth.uid() works
 * 
 * Called by client-side Supabase client to get a valid JWT.
 */
export async function GET() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress ?? null;

  const SUPABASE_URL = required("NEXT_PUBLIC_SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = required("SUPABASE_SERVICE_ROLE_KEY");
  const SUPABASE_JWT_SECRET = required("SUPABASE_JWT_SECRET");

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // Upsert app user (Clerk is source of identity)
  const { data: upserted, error: upsertErr } = await supabaseAdmin
    .from("app_users")
    .upsert(
      { clerk_user_id: clerkUserId, email },
      { onConflict: "clerk_user_id" }
    )
    .select("id")
    .single();

  if (upsertErr || !upserted?.id) {
    return NextResponse.json(
      { error: "failed_to_upsert_app_user", details: upsertErr?.message },
      { status: 500 }
    );
  }

  const buddyUserId = upserted.id as string;

  // Mint Supabase-compatible JWT.
  // IMPORTANT: sub MUST be uuid string = app_users.id
  const secret = new TextEncoder().encode(SUPABASE_JWT_SECRET);

  const jwt = await new SignJWT({
    role: "authenticated",
    // put Buddy-specific claims under app_metadata-ish namespace if you want later
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
}
