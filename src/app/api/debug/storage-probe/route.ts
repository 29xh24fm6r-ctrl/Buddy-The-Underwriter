import "server-only";

import { NextResponse } from "next/server";
import { getVercelOidcToken } from "@/lib/google/getVercelOidcToken";
import { exchangeOidcForFederatedAccessToken } from "@/lib/google/wifSts";
import { generateAccessToken, signBlob } from "@/lib/google/iamCredentials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeErrorMessage(message: string) {
  return message.length > 240 ? `${message.slice(0, 239)}…` : message;
}

export async function GET(req: Request) {
  const debug = process.env.BUDDY_GOOGLE_AUTH_DEBUG === "1";
  const bucket = process.env.GCS_BUCKET || null;
  const project = process.env.GCP_PROJECT_ID || null;
  const saEmail = process.env.GCP_SERVICE_ACCOUNT_EMAIL || null;

  const result: any = {
    ok: false,
    hasOidc: false,
    canFederate: false,
    canImpersonate: false,
    canSign: false,
    bucket,
    project,
    saEmail,
  };

  try {
    const oidc = await getVercelOidcToken(req);
    result.hasOidc = Boolean(oidc);

    if (!oidc) {
      return NextResponse.json({
        ...result,
        error: { stage: "oidc", message: "Missing Vercel OIDC token" },
      });
    }

    const federated = await exchangeOidcForFederatedAccessToken(oidc);
    result.canFederate = Boolean(federated);

    const saToken = await generateAccessToken(federated);
    result.canImpersonate = Boolean(saToken);

    const signed = await signBlob(saToken, new TextEncoder().encode("storage-probe"));
    result.canSign = signed.length > 0;
    result.ok = result.canSign === true;

    return NextResponse.json(result);
  } catch (e: any) {
    const message = safeErrorMessage(String(e?.message ?? e));
    const error = { stage: "unknown", message };
    if (debug) {
      error.stage = String(e?.stage ?? error.stage);
    }
    return NextResponse.json({
      ...result,
      error,
    });
  }
}
