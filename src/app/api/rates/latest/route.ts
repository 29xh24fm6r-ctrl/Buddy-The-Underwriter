import { NextResponse } from "next/server";
import {
  getLatestIndexRates,
  RateFeedUnavailableError,
} from "@/lib/rates/indexRates";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  try {
    const rates = await getLatestIndexRates();
    return NextResponse.json({ ok: true, rates });
  } catch (error) {
    console.error("[rates.latest] benchmark feed unavailable", {
      error: error instanceof Error ? error.message : "unknown error",
    });
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof RateFeedUnavailableError
            ? error.message
            : "benchmark rate feed is temporarily unavailable",
        retryable: true,
      },
      { status: 503, headers: { "Retry-After": "60" } },
    );
  }
}
