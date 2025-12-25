import { NextRequest, NextResponse } from "next/server";
import { getLatestRuleVersion } from "@/lib/rules/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const rule_set_key = searchParams.get("rule_set_key");

    if (!rule_set_key) {
      return NextResponse.json(
        { ok: false, error: "rule_set_key is required" },
        { status: 400 },
      );
    }

    const { ruleSet, latest } = await getLatestRuleVersion(rule_set_key);
    return NextResponse.json({ ok: true, ruleSet, latest });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? String(err) },
      { status: 500 },
    );
  }
}
