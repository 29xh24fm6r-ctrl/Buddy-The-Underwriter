#!/usr/bin/env node
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { fetchWithDiagnostics, isHtml, redactSecrets } from "./_http.mjs";

const run = (cmd) =>
  execSync(cmd, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

const tryRun = (cmd) => {
  try {
    return run(cmd);
  } catch {
    return null;
  }
};

const parseArgs = (argv) => {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        args[key] = next;
        i += 1;
      } else {
        args[key] = true;
      }
    } else {
      args._.push(token);
    }
  }
  return args;
};

const buildHeaders = (authHeaders = {}, extraHeaders = {}) => ({
  "Cache-Control": "no-store",
  ...authHeaders,
  ...extraHeaders,
});

/**
 * @param {{ baseUrl: string, fetchImpl?: typeof fetch, secrets?: string[] }} params
 */
const resolveMeta = async ({ baseUrl, fetchImpl = fetch, secrets = [] }) => {
  const candidates = ["/api/meta/build", "/api/meta"];
  const diagnostics = [];
  for (const path of candidates) {
    const url = `${baseUrl}${path}`;
    const result = await fetchWithDiagnostics(
      url,
      { headers: { "Cache-Control": "no-store" } },
      { label: "meta", fetchImpl, secrets }
    );
    diagnostics.push(result.diag);
    const isValid = result.res?.ok && !isHtml(result.text, result.res);
    if (isValid) {
      return {
        ok: true,
        url,
        payload: result.json ?? { raw: result.text },
        metaFallback: path !== "/api/meta/build",
        diagnostics,
      };
    }
  }
  return { ok: false, url: null, payload: null, metaFallback: true, diagnostics };
};

const isRedirectStatus = (status) =>
  status === 301 || status === 302 || status === 303 || status === 307 || status === 308;

/**
 * @param {{ url: string, token: string, fetchImpl?: typeof fetch, secrets?: string[] }} params
 */
const probeAuthHeaders = async ({ url, token, fetchImpl = fetch, secrets = [] }) => {
  const headerOptions = [
    { mode: "x-buddy-builder-token", headers: { "x-buddy-builder-token": token } },
    { mode: "authorization", headers: { Authorization: `Bearer ${token}` } },
    {
      mode: "both",
      headers: {
        "x-buddy-builder-token": token,
        Authorization: `Bearer ${token}`,
      },
    },
  ];
    const diagnostics = [];
  for (const option of headerOptions) {
    const result = await fetchWithDiagnostics(
      url,
      { headers: buildHeaders(option.headers) },
      { label: "token-status", fetchImpl, secrets }
    );
    const html = isHtml(result.text, result.res);
    const redirected = Boolean(result.diag.redirected || isRedirectStatus(result.res?.status));
    diagnostics.push({
      mode: option.mode,
      auth: result.res?.ok ?? false,
      html,
      redirected,
      ...result.diag,
    });
    const isValid = result.res?.ok && !html && !redirected;
    if (isValid) {
      return {
        headers: option.headers,
        mode: option.mode,
        tokenStatus: result.json ?? { raw: result.text },
        diagnostics,
      };
    }
  }
  return { headers: null, mode: null, tokenStatus: null, diagnostics };
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(`\nUsage:\n  node scripts/verify-underwrite.mjs --base <url>\n\nOptions:\n  --base     Preview base URL (or set PREVIEW_URL/VERCEL_URL)\n  --help     Show this help\n\nRequires BUDDY_BUILDER_VERIFY_TOKEN.\n\nUI verification intentionally removed — server invariant is canonical.\n`);
    process.exit(0);
  }

  const previewUrl =
    args.base ||
    process.env.PREVIEW_URL ||
    process.env.VERCEL_URL ||
    tryRun("node scripts/vercel-latest-url.mjs");

  if (!previewUrl) {
    console.error("[verify:underwrite] Unable to determine preview URL.");
    process.exit(1);
  }

  const token = process.env.BUDDY_BUILDER_VERIFY_TOKEN || "";
  if (!token) {
    console.error("[verify:underwrite] Missing BUDDY_BUILDER_VERIFY_TOKEN env.");
    process.exit(1);
  }

  const baseUrl = previewUrl.startsWith("http")
    ? previewUrl
    : `https://${previewUrl}`;

  const secrets = [token];
  const tokenStatusUrl = `${baseUrl}/api/builder/token/status`;
  const auditUrl = `${baseUrl}/api/builder/stitch/audit`;
  const mintUrl = `${baseUrl}/api/builder/deals/mint`;
  const makeReadyUrl = `${baseUrl}/api/builder/deals/make-ready`;
  const googleVerifyUrl = `${baseUrl}/api/_builder/verify/google`;

  console.log(`[verify:underwrite] Using preview ${baseUrl}`);

  const metaResult = await resolveMeta({ baseUrl, secrets });
  if (metaResult.ok) {
    console.log("[verify:underwrite] Build meta", {
      status: metaResult.diagnostics.at(-1)?.status ?? null,
      sha: metaResult.payload?.git?.sha ?? null,
      ref: metaResult.payload?.git?.ref ?? null,
      deploymentId: metaResult.payload?.vercel?.deploymentId ?? null,
    });
  } else {
    console.warn("[verify:underwrite] Build meta unavailable");
  }

  const authProbe = await probeAuthHeaders({
    url: tokenStatusUrl,
    token,
    secrets,
  });

  if (!authProbe.headers) {
    const authOutput = {
      baseUrl,
      ok: false,
      reason: "auth_failed",
      diagnostics: {
        meta: metaResult.diagnostics,
        authProbe: authProbe.diagnostics,
      },
    };
    console.log(JSON.stringify(redactSecrets(authOutput, secrets), null, 2));
    return;
  }

  console.log(`[verify:underwrite] Builder auth header: ${authProbe.mode}`);

  const diagnostics = {
    meta: metaResult.diagnostics,
    authProbe: authProbe.diagnostics,
    requests: [],
  };

  const requestJson = async (label, url, options = {}) => {
    const result = await fetchWithDiagnostics(url, options, {
      label,
      secrets,
    });
    diagnostics.requests.push(result.diag);
    return { ...result, payload: result.json ?? { raw: result.text } };
  };

  const audit = await requestJson("stitch-audit", auditUrl, {
    headers: buildHeaders(authProbe.headers),
  });

  const googleVerify = await requestJson("verify-google", googleVerifyUrl, {
    headers: buildHeaders(authProbe.headers),
  });

  const googleOk =
    googleVerify.payload?.adc?.ok === true &&
    googleVerify.payload?.gcs?.ok === true &&
    googleVerify.payload?.vertex?.ok === true;

  if (!googleOk) {
    console.error("[verify:underwrite] Google verify failed");
    console.error(JSON.stringify(redactSecrets(googleVerify.payload ?? {}, secrets), null, 2));
    process.exit(1);
  }

  const minted = await requestJson("mint-deal", mintUrl, {
    method: "POST",
    headers: buildHeaders(authProbe.headers),
  });

  const dealId = minted.payload?.dealId ?? null;
  if (!dealId) {
    console.error("[verify:underwrite] Failed to mint builder deal");
    console.error(JSON.stringify(redactSecrets(minted.payload ?? {}, secrets), null, 2));
    process.exit(1);
  }

  const blocked = await requestJson(
    "verify-blocked",
    `${baseUrl}/api/builder/verify/underwrite?dealId=${dealId}`,
    { headers: buildHeaders(authProbe.headers) }
  );

  const ready = await requestJson("make-ready", makeReadyUrl, {
    method: "POST",
    headers: buildHeaders(authProbe.headers, {
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({ dealId }),
  });

  const verifiedReady = await requestJson(
    "verify-ready",
    `${baseUrl}/api/builder/verify/underwrite?dealId=${dealId}`,
    { headers: buildHeaders(authProbe.headers) }
  );

  const decisionSnapshots = [];
  for (let i = 0; i < 3; i += 1) {
    const snap = await requestJson(
      "decision-latest",
      `${baseUrl}/api/builder/deals/${dealId}/decision/latest`,
      { headers: buildHeaders(authProbe.headers) }
    );
    decisionSnapshots.push({ status: snap.res?.status ?? null, payload: snap.payload });
  }

  const financialDecision = await requestJson(
    "financial-decision",
    `${baseUrl}/api/builder/deals/${dealId}/financial-snapshot/decision`,
    { headers: buildHeaders(authProbe.headers) }
  );

  const output = {
    baseUrl,
    tokenStatus: authProbe.tokenStatus,
    stitchAudit: audit.payload,
    googleVerify: googleVerify.payload,
    minted: minted.payload,
    blockedVerify: blocked.payload,
    readyMutation: ready.payload,
    readyVerify: verifiedReady.payload,
    decisionLatest: decisionSnapshots,
    financialSnapshotDecision: financialDecision.payload,
    diagnostics,
    metaFallback: metaResult.metaFallback,
  };

  console.log(JSON.stringify(redactSecrets(output, secrets), null, 2));
};

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  await main();
}

export { buildHeaders, main, probeAuthHeaders, resolveMeta };
