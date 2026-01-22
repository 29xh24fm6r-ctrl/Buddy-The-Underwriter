import type { NextApiRequest, NextApiResponse } from "next";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireBuilderTokenApi } from "@/lib/builder/requireBuilderTokenApi";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  if (!(await requireBuilderTokenApi(req, res))) {
    return;
  }

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("deals")
    .select("id, created_at, name")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return res.status(500).json({ ok: false, error: "db_error", message: error.message });
  }

  if (!data) {
    return res.status(404).json({ ok: false, error: "no_deals" });
  }

  return res.status(200).json({
    ok: true,
    dealId: data.id,
    createdAt: data.created_at,
    name: data.name ?? null,
  });
}
