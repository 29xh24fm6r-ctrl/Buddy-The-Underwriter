import { randomUUID } from "crypto";
import type { NextRequest } from "next/server";

export function getRequestId(req?: NextRequest) {
  const headerId = req?.headers.get("x-request-id") || req?.headers.get("x-amzn-trace-id");
  return headerId || randomUUID();
}
