import type { NextRequest } from "next/server";
import { randomUUID } from "crypto";

export function getRequestId(req?: NextRequest) {
  const xff = req?.headers.get("x-request-id");
  const amzn = req?.headers.get("x-amzn-trace-id");
  return xff || amzn || randomUUID();
}
