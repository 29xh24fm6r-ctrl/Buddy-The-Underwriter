import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  email: z.string().email(),
  role: z.string().min(2).max(40).optional(),
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
  const role = String(parsed.role || "banker").trim().toLowerCase() || "banker";

  const sb = supabaseAdmin();

  try {
    const { data: existing, error: findErr } = await sb
      .from("sandbox_access_allowlist")
      .select("id")
      .ilike("email", email)
      .maybeSingle();

    if (findErr) {
      return NextResponse.json(
        { ok: false, error: findErr.message },
        { status: 500 },
      );
    }

    if (existing?.id) {
      const { error: updErr } = await sb
        .from("sandbox_access_allowlist")
        .update({ email, role, enabled: true })
        .eq("id", existing.id);

      if (updErr) {
        return NextResponse.json(
          { ok: false, error: updErr.message },
          { status: 500 },
        );
      }
    } else {
      const { error: insErr } = await sb
        .from("sandbox_access_allowlist")
        .insert({ email, enabled: true, role });

      if (insErr) {
        return NextResponse.json(
          { ok: false, error: insErr.message },
          { status: 500 },
        );
      }
    }

    await sb.from("demo_user_activity").upsert(
      {
        email,
        role,
      },
      { onConflict: "email" },
    );

    await sb.from("demo_usage_events").insert({
      email,
      event_type: "action",
      route: "/admin/demo-access",
      label: "admin_allowlist_upsert",
      meta: { role },
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("/api/admin/demo/access/upsert", err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? "upsert_failed" },
      { status: 500 },
    );
  }
}
