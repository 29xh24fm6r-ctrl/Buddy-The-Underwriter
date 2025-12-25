import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeBool(v: any) {
  return Boolean(v && String(v).trim());
}

function maskUrl(u?: string) {
  if (!u) return null;
  try {
    const url = new URL(u);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "(invalid url)";
  }
}

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  const env = {
    NEXT_PUBLIC_SUPABASE_URL: safeBool(url),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: safeBool(anon),
    SUPABASE_SERVICE_ROLE_KEY: safeBool(service),
    url_host: maskUrl(url),
  };

  if (!env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json(
      { ok: false, env, error: "Missing NEXT_PUBLIC_SUPABASE_URL" },
      { status: 500 },
    );
  }

  const apiKey = service.trim() ? service.trim() : anon.trim();
  if (!apiKey) {
    return NextResponse.json(
      {
        ok: false,
        env,
        error:
          "Missing both SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_ANON_KEY",
      },
      { status: 500 },
    );
  }

  // Raw REST probe: if this fails with fetch failed, it's DNS/network/URL invalid.
  const probeUrl = `${url.replace(/\/+$/, "")}/rest/v1/?select=1`;

  try {
    const res = await fetch(probeUrl, {
      method: "GET",
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${apiKey}`,
      },
    });

    const text = await res.text();

    return NextResponse.json(
      {
        ok: res.ok,
        env,
        probeUrl: maskUrl(probeUrl),
        status: res.status,
        statusText: res.statusText,
        bodyPreview: text.slice(0, 300),
        hint: res.ok
          ? "✅ Server can reach Supabase REST. If supabase-js still fails, it's client config/import/runtime."
          : "Env present but REST responded non-200. If status=401, key is wrong. If 404, URL is wrong (not *.supabase.co).",
      },
      { status: 200 },
    );
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        env,
        probeUrl: maskUrl(probeUrl),
        error: e?.message || "fetch_failed",
        hint: "If this says fetch failed: your NEXT_PUBLIC_SUPABASE_URL is wrong OR env is not injected into the running app OR DNS/network issue in Codespaces.",
      },
      { status: 200 },
    );
  }
}
