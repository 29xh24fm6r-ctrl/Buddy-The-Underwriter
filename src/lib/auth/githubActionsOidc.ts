import "server-only";

import { createRemoteJWKSet, jwtVerify } from "jose";
import { hasValidBrokerageCertificationClaims } from "./githubActionsOidcClaims";

const ISSUER = "https://token.actions.githubusercontent.com";
export const BROKERAGE_CERTIFICATION_AUDIENCE =
  "buddy-brokerage-production-certification";
const JWKS = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks`));

export async function verifyBrokerageCertificationOidc(
  request: Request,
): Promise<import("jose").JWTPayload | null> {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return null;

  try {
    const { payload } = await jwtVerify(authorization.slice(7), JWKS, {
      issuer: ISSUER,
      audience: BROKERAGE_CERTIFICATION_AUDIENCE,
    });
    return hasValidBrokerageCertificationClaims(payload) ? payload : null;
  } catch {
    return null;
  }
}

export async function hasValidBrokerageCertificationOidc(
  request: Request,
): Promise<boolean> {
  return Boolean(await verifyBrokerageCertificationOidc(request));
}
