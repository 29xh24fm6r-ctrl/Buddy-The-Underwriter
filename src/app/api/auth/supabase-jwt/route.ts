import { NextResponse } from "next/server";
import { clerkAuth, clerkCurrentUser } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { SignJWT } from "jose";

function getEnv(name: string) {
  const value = process.env[name];
  return value && value.trim().length ? value.trim() : null;
}

/**
 * Token exchange: Clerk -> Supabase JWT.
 *
 * The JWT subject is profiles.id because bank_memberships and Buddy's RLS
 * policies use that UUID as auth.uid(). app_users.id remains available as a
 * separate claim for platform-admin relationships.
 */
export async function GET() {
  try {
    const { userId: clerkUserId } = await clerkAuth();
    if (!clerkUserId) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const jwtSecret = getEnv("SUPABASE_JWT_SECRET");
    if (!jwtSecret) {
      return NextResponse.json(
        { error: "supabase_jwt_signing_unavailable" },
        { status: 503 },
      );
    }

    const user = await clerkCurrentUser();
    const email = user?.emailAddresses?.[0]?.emailAddress ?? null;
    const sb = supabaseAdmin();

    const [appUserResult, profileResult] = await Promise.all([
      sb
        .from("app_users")
        .upsert(
          { clerk_user_id: clerkUserId, email },
          { onConflict: "clerk_user_id" },
        )
        .select("id")
        .single(),
      sb
        .from("profiles")
        .select("id")
        .eq("clerk_user_id", clerkUserId)
        .maybeSingle(),
    ]);

    if (appUserResult.error || !appUserResult.data?.id) {
      console.error("[supabase-jwt] app user resolution failed", {
        clerkUserId,
        code: appUserResult.error?.code ?? null,
      });
      return NextResponse.json(
        { error: "app_user_resolution_failed" },
        { status: 500 },
      );
    }

    if (profileResult.error) {
      console.error("[supabase-jwt] profile resolution failed", {
        clerkUserId,
        code: profileResult.error.code,
      });
      return NextResponse.json(
        { error: "profile_resolution_failed" },
        { status: 500 },
      );
    }

    if (!profileResult.data?.id) {
      return NextResponse.json(
        { error: "profile_required" },
        { status: 403 },
      );
    }

    const appUserId = String(appUserResult.data.id);
    const buddyUserId = String(profileResult.data.id);
    const secret = new TextEncoder().encode(jwtSecret);

    const token = await new SignJWT({
      role: "authenticated",
      app_user_id: appUserId,
      profile_id: buddyUserId,
      clerk_user_id: clerkUserId,
      email,
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(buddyUserId)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(secret);

    return NextResponse.json({ token, buddyUserId, appUserId });
  } catch (error) {
    console.error("[supabase-jwt] unexpected failure", error);
    return NextResponse.json(
      { error: "token_exchange_failed" },
      { status: 500 },
    );
  }
}
