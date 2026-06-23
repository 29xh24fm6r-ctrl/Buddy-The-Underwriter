import "server-only";

import { NextResponse } from "next/server";
import { clerkAuth, clerkClient, isClerkConfigured } from "@/lib/auth/clerkServer";
import { isBuddyRole, BUDDY_ROLES } from "@/lib/auth/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/whoami — auth diagnostic.
 *
 * Returns what the server resolves for the CALLER's own session: Clerk
 * user id, the raw publicMetadata.role value, whether it validates
 * against BUDDY_ROLES, and whether the user is on the
 * ADMIN_CLERK_USER_IDS allowlist. Reveals nothing about anyone else —
 * it only reflects the caller's identity back at them — so it needs no
 * role gate, just a signed-in session.
 *
 * Use case: "I set my role in Clerk but /admin still bounces me." The
 * usual causes are editing the wrong Clerk instance (Development vs
 * Production have separate user lists), putting the role in private/
 * unsafe metadata instead of public, or a typo in the role string.
 * This endpoint shows which one it is.
 */
export async function GET() {
  if (!isClerkConfigured()) {
    return NextResponse.json(
      { ok: false, error: "clerk_not_configured" },
      { status: 500 },
    );
  }

  const { userId } = await clerkAuth();
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: "not_signed_in" },
      { status: 401 },
    );
  }

  const allowlist = (process.env.ADMIN_CLERK_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const allowlisted = allowlist.includes(userId);

  let publicMetadataRole: unknown = null;
  let clerkError: string | null = null;
  try {
    const client = await clerkClient();
    if (client) {
      const user = await client.users.getUser(userId);
      publicMetadataRole = (user.publicMetadata as any)?.role ?? null;
    } else {
      clerkError = "clerk_client_unavailable";
    }
  } catch (e) {
    clerkError = e instanceof Error ? e.message : String(e);
  }

  const resolvedRole = allowlisted
    ? "super_admin"
    : isBuddyRole(publicMetadataRole)
      ? publicMetadataRole
      : null;

  return NextResponse.json({
    ok: true,
    userId,
    allowlisted,
    publicMetadataRole,
    roleIsValid: isBuddyRole(publicMetadataRole),
    resolvedRole,
    adminAccess: resolvedRole === "super_admin",
    validRoles: BUDDY_ROLES,
    clerkError,
    hint:
      resolvedRole === "super_admin"
        ? "You have admin access. If /admin still bounces you, hard-refresh."
        : publicMetadataRole == null
          ? "No role found in publicMetadata. Check: (1) you edited the PRODUCTION Clerk instance, not Development — they have separate user lists; (2) the role is in PUBLIC metadata; (3) the userId above matches the user you edited."
          : "A role value exists but is not valid. It must be exactly one of validRoles (lowercase, underscore).",
  });
}
