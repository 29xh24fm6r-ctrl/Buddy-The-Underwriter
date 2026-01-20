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

export function buildBuilderTokenStatus(req: Request): {
  ok: true;
  auth: boolean;
  envPresent: boolean;
  headerPresent: boolean;
  tokenHash: string | null;
} {
  const expectedToken = process.env.BUDDY_BUILDER_VERIFY_TOKEN ?? "";
  const providedToken = req.headers.get("x-buddy-builder-token") ?? "";
  const envPresent = expectedToken.length > 0;
  const headerPresent = providedToken.length > 0;

  if (!envPresent) {
    return {
      ok: true,
      auth: false,
      envPresent: false,
      headerPresent,
      tokenHash: null,
    };
  }

  const expectedHash = sha256(expectedToken);
  const providedHash = sha256(providedToken);
  const auth = timingSafeEqual(expectedHash, providedHash);

  return {
    ok: true,
    auth,
    envPresent: true,
    headerPresent,
    tokenHash: `sha256:${expectedHash.toString("hex")}`,
  };
}

export function mustBuilderToken(req: Request): { ok: true } {
  const status = buildBuilderTokenStatus(req);
  if (!status.envPresent || !status.auth) {
    throw NextResponse.json(UNAUTHORIZED_PAYLOAD, { status: 401 });
  }
  return { ok: true };
}
