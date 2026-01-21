import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";

const UNAUTHORIZED_PAYLOAD = {
  ok: false,
  auth: false,
  error: "unauthorized",
  message: "Missing or invalid builder verify token.",
} as const;

function sha256(input: string): Buffer {
  return createHash("sha256").update(input).digest();
}

function shaPrefix(input: string) {
  const hex = createHash("sha256").update(input).digest("hex");
  return `sha256:${hex.slice(0, 12)}`;
}

function raw(value: string | null | undefined) {
  return value ?? "";
}

function trimmed(value: string | null | undefined) {
  return (value ?? "").trim();
}

export function buildBuilderTokenStatus(req: Request): {
  ok: true;
  auth: boolean;
  envPresent: boolean;
  headerPresent: boolean;
  tokenHash: string | null;
  envLenRaw: number;
  envLenTrim: number;
  headerLenRaw: number;
  headerLenTrim: number;
  envHashRaw: string | null;
  envHashTrim: string | null;
  headerHashRaw: string | null;
  headerHashTrim: string | null;
  authRaw: boolean;
  authTrim: boolean;
} {
  const envRaw = raw(process.env.BUDDY_BUILDER_VERIFY_TOKEN);
  const envTrim = trimmed(process.env.BUDDY_BUILDER_VERIFY_TOKEN);
  const headerRaw = raw(req.headers.get("x-buddy-builder-token"));
  const headerTrim = trimmed(req.headers.get("x-buddy-builder-token"));

  const envPresent = envRaw.length > 0;
  const headerPresent = headerRaw.length > 0;

  if (!envPresent) {
    return {
      ok: true,
      auth: false,
      envPresent: false,
      headerPresent,
      tokenHash: null,
      envLenRaw: envRaw.length,
      envLenTrim: envTrim.length,
      headerLenRaw: headerRaw.length,
      headerLenTrim: headerTrim.length,
      envHashRaw: null,
      envHashTrim: null,
      headerHashRaw: headerRaw ? shaPrefix(headerRaw) : null,
      headerHashTrim: headerTrim ? shaPrefix(headerTrim) : null,
      authRaw: false,
      authTrim: false,
    };
  }

  const expectedHash = sha256(envTrim);
  const providedHash = sha256(headerTrim);
  const authTrim = envTrim.length > 0 && headerTrim.length > 0 && timingSafeEqual(expectedHash, providedHash);
  const authRaw = envRaw.length > 0 && headerRaw.length > 0 && envRaw === headerRaw;

  return {
    ok: true,
    auth: authTrim,
    envPresent: true,
    headerPresent,
    tokenHash: envTrim ? shaPrefix(envTrim) : envRaw ? shaPrefix(envRaw) : null,
    envLenRaw: envRaw.length,
    envLenTrim: envTrim.length,
    headerLenRaw: headerRaw.length,
    headerLenTrim: headerTrim.length,
    envHashRaw: envRaw ? shaPrefix(envRaw) : null,
    envHashTrim: envTrim ? shaPrefix(envTrim) : null,
    headerHashRaw: headerRaw ? shaPrefix(headerRaw) : null,
    headerHashTrim: headerTrim ? shaPrefix(headerTrim) : null,
    authRaw,
    authTrim,
  };
}

export function mustBuilderToken(req: Request): { ok: true } {
  const status = buildBuilderTokenStatus(req);
  if (!status.envPresent || !status.auth) {
    throw NextResponse.json(UNAUTHORIZED_PAYLOAD, { status: 401 });
  }
  return { ok: true };
}
