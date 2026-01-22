import { NextResponse } from "next/server";
import { VertexAI } from "@google-cloud/vertexai";
import { ensureGcpAdcBootstrap, getVertexAuthOptions } from "@/lib/gcpAdcBootstrap";

export const runtime = "nodejs";

export async function GET() {
  if (process.env.ALLOW_GEMINI_PROBE !== "true") {
    return NextResponse.json({ ok: false, error: "Probe disabled" }, { status: 403 });
  }

  const project =
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCP_PROJECT_ID;

  const location = process.env.GOOGLE_CLOUD_LOCATION || "us-central1";
  const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";

  if (!project) {
    return NextResponse.json(
      { ok: false, error: "Missing GOOGLE_CLOUD_PROJECT/GCP_PROJECT_ID" },
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

    return NextResponse.json({ ok: true, project, location, model, text });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, project, location, model, error: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
