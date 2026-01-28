import type { NextApiRequest, NextApiResponse } from "next";

import { mustBuilderToken } from "@/lib/builder/mustBuilderTokenCore";

function buildRequest(req: NextApiRequest): Request {
  const url = new URL(req.url ?? "/", "http://localhost");
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      headers.set(key, value.join(","));
    } else if (value) {
      headers.set(key, value);
    }
  }
  return new Request(url.toString(), { headers, method: req.method });
}

export async function requireBuilderTokenApi(
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<boolean> {
  const request = buildRequest(req);
  try {
    mustBuilderToken(request);
    return true;
  } catch (err: any) {
    if (err instanceof Response) {
      const body = await err.json().catch(() => null);
      res.status(err.status || 401).json(
        body ?? { ok: false, auth: false, error: "unauthorized", message: "Unauthorized" },
      );
      return false;
    }
    res.status(401).json({
      ok: false,
      auth: false,
      error: "unauthorized",
      message: String(err?.message ?? err ?? "Unauthorized"),
    });
    return false;
  }
}
