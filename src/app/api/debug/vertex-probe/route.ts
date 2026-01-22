import { NextResponse } from "next/server";
import { VertexAI } from "@google-cloud/vertexai";
import { ensureGcpAdcBootstrap, getVertexAuthOptions } from "@/lib/gcpAdcBootstrap";

export const runtime = "nodejs";

export async function GET(req: Request) {
  if (process.env.ALLOW_GEMINI_PROBE !== "true") {
    return NextResponse.json({ ok: false, error: "Probe disabled" }, { status: 403 });
  }

  const oidcHeader = req.headers.get("x-vercel-oidc-token");
  const oidcEnv = process.env.VERCEL_OIDC_TOKEN || process.env.VERCEL_OIDC_TOKEN_0 || null;
  const hasOidcHeader = Boolean(oidcHeader);
  const hasOidcEnv = Boolean(oidcEnv);
  let oidcClaims: Record<string, unknown> | null = null;
  if (oidcHeader) {
    const parts = oidcHeader.split(".");
    if (parts.length >= 2) {
      try {
        const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
        oidcClaims = {
          iss: payload?.iss ?? null,
          aud: payload?.aud ?? null,
          sub: payload?.sub ?? null,
          exp: payload?.exp ?? null,
          iat: payload?.iat ?? null,
        };
      } catch {
        oidcClaims = null;
      }
    }
  }

  const project =
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCP_PROJECT_ID;

  const location = process.env.GOOGLE_CLOUD_LOCATION || "us-central1";
  const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";

  if (!project) {
    return NextResponse.json(
      { ok: false, hasOidcHeader, hasOidcEnv, oidcClaims, error: "Missing GOOGLE_CLOUD_PROJECT/GCP_PROJECT_ID" },
      { status: 500 }
    );
  }

  try {
    await ensureGcpAdcBootstrap();
    const googleAuthOptions = await getVertexAuthOptions();
    const vertex = new VertexAI({
      project,
      location,
      ...(googleAuthOptions ? { googleAuthOptions: googleAuthOptions as any } : {}),
    });
    const gm = vertex.getGenerativeModel({ model });

    const resp = await gm.generateContent({
      contents: [{ role: "user", parts: [{ text: "Say only: ok" }] }],
    });

    const text =
      resp?.response?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;

    return NextResponse.json({
      ok: true,
      hasOidcHeader,
      hasOidcEnv,
      oidcClaims,
      project,
      location,
      model,
      text,
    });
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        hasOidcHeader,
        hasOidcEnv,
        oidcClaims,
        project,
        location,
        model,
        error: String(e?.message ?? e),
      },
      { status: 500 }
    );
  }
}
