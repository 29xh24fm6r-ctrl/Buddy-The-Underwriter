// src/app/api/health/azure/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const endpoint = process.env.AZURE_DI_ENDPOINT;
  const apiKey = process.env.AZURE_DI_KEY;

  if (!endpoint || !apiKey) {
    return Response.json(
      { ok: false, error: "Azure DI not configured", hasEndpoint: !!endpoint, hasKey: !!apiKey },
      { status: 500 }
    );
  }

  const url =
    endpoint.replace(/\/+$/, "") +
    "/documentintelligence/documentModels?api-version=2024-02-29-preview";

  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: { "Ocp-Apim-Subscription-Key": apiKey },
    });

    const text = await resp.text();

    return Response.json(
      { ok: resp.ok, status: resp.status, sample: text.slice(0, 300) },
      { status: resp.ok ? 200 : 502 }
    );
  } catch (err: any) {
    return Response.json(
      { ok: false, error: "Azure health check failed", message: err?.message },
      { status: 502 }
    );
  }
}
