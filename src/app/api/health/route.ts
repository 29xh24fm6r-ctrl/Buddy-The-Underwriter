import "server-only";

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const LIVENESS = Object.freeze({
  ok: true,
  status: "ok",
  service: "buddy-the-underwriter",
});

export async function GET() {
  return NextResponse.json(LIVENESS, {
    status: 200,
    headers: {
      "cache-control": "no-store, max-age=0",
    },
  });
}
