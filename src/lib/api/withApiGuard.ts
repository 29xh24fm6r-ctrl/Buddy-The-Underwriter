import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getRequestId } from "@/lib/obs/requestId";
import { rateLimit } from "@/lib/api/rateLimit";

type Handler<T = unknown> = (req: NextRequest) => Promise<NextResponse<T>>;

export function withApiGuard(
  opts: {
    tag: string;
    requireAuth?: boolean;
    rate?: { limit: number; windowMs: number };
  },
  handler: Handler
) {
  return async (req: NextRequest) => {
    const requestId = getRequestId(req);

    try {
      let userId: string | null = null;

      if (opts.requireAuth) {
        const a = await auth();
        userId = a.userId ?? null;
        if (!userId) {
          return NextResponse.json(
            { ok: false, error: "unauthorized", requestId } as any,
            { status: 401, headers: { "x-request-id": requestId } }
          );
        }
      }

      if (opts.rate) {
        const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "ip:unknown";
        const key = `${opts.tag}:${userId ?? "anon"}:${ip}`;
        const r = rateLimit({ key, limit: opts.rate.limit, windowMs: opts.rate.windowMs });
        if (!r.ok) {
          return NextResponse.json(
            { ok: false, error: "rate_limited", requestId, resetAt: r.resetAt } as any,
            { status: 429, headers: { "x-request-id": requestId } }
          );
        }
      }

      const res = await handler(req);
      res.headers.set("x-request-id", requestId);
      return res;
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error(`[api:${opts.tag}]`, requestId, err?.message || err);
      return NextResponse.json(
        { ok: false, error: "internal_error", requestId } as any,
        { status: 500, headers: { "x-request-id": requestId } }
      );
    }
  };
}
