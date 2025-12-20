// src/lib/interview/http.ts
import { NextResponse } from "next/server";

export function jsonOk(data: unknown, init?: ResponseInit) {
  return NextResponse.json({ ok: true, ...asObj(data) }, { status: 200, ...init });
}

export function jsonCreated(data: unknown) {
  return NextResponse.json({ ok: true, ...asObj(data) }, { status: 201 });
}

export function jsonBadRequest(message: string, details?: unknown) {
  return NextResponse.json({ ok: false, error: message, details }, { status: 400 });
}

export function jsonUnauthorized(message = "unauthorized") {
  return NextResponse.json({ ok: false, error: message }, { status: 401 });
}

export function jsonNotFound(message = "not_found") {
  return NextResponse.json({ ok: false, error: message }, { status: 404 });
}

export function jsonServerError(message = "server_error", details?: unknown) {
  return NextResponse.json({ ok: false, error: message, details }, { status: 500 });
}

function asObj(x: unknown): Record<string, unknown> {
  if (x && typeof x === "object" && !Array.isArray(x)) return x as Record<string, unknown>;
  return { data: x };
}
