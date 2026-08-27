import { NextResponse } from "next/server";
import {
  PortalLinkError,
  resolveBorrowerToken,
} from "@/lib/portal/resolveBorrowerToken";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const token = String(body?.token ?? "").trim();
  if (!token) {
    return NextResponse.json(
      { ok: false, error: "missing_token" },
      { status: 400 },
    );
  }

  try {
    const resolved = await resolveBorrowerToken(token);
    return NextResponse.json({ ok: true, dealId: resolved.deal_id });
  } catch (error) {
    const status = error instanceof PortalLinkError ? error.status : 500;
    return NextResponse.json(
      {
        ok: false,
        error: status === 500 ? "token_validation_failed" : "invalid_token",
      },
      { status },
    );
  }
}
