import { NextRequest, NextResponse } from "next/server";
import { upsertNewRuleVersion } from "@/lib/rules/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { rule_set_key, version, rules, fetched_at } = body ?? {};

    if (!rule_set_key || !version || !rules) {
      return NextResponse.json(
        { ok: false, error: "rule_set_key, version, rules are required" },
        { status: 400 },
      );
    }

    const result = await upsertNewRuleVersion({
      rule_set_key,
      version,
      fetched_at,
      rules,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? String(err) },
      { status: 500 },
    );
  }
}
