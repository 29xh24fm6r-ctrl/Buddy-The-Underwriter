import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  email: z.string().email(),
});

async function enforceSuperAdmin() {
  try {
    await requireSuperAdmin();
    return null;
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    if (msg === "unauthorized")
      return NextResponse.json(
        { ok: false, error: "unauthorized" },
        { status: 401 },
      );
    if (msg === "forbidden")
      return NextResponse.json(
        { ok: false, error: "forbidden" },
        { status: 403 },
      );
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

function normalizeEmail(email?: string | null) {
  return String(email || "").trim().toLowerCase();
}

export async function POST(req: Request) {
  const auth = await enforceSuperAdmin();
  if (auth) return auth;

  let parsed;
  try {
    parsed = BodySchema.parse(await req.json());
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: "invalid_payload" },
      { status: 400 },
    );
  }

  const email = normalizeEmail(parsed.email);
  const sb = supabaseAdmin();

  try {
    const { error } = await sb
      .from("sandbox_access_allowlist")
      .delete()
      .ilike("email", email);

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 },
      );
    }

    await sb.from("demo_usage_events").insert({
      email,
      event_type: "action",
      route: "/admin/demo-access",
      label: "admin_allowlist_remove",
      meta: {},
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("/api/admin/demo/access/remove", err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? "remove_failed" },
      { status: 500 },
    );
  }
}
