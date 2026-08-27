/**
 * Bucket CORS operations for the direct-to-storage upload path.
 *
 *   pnpm gcs:cors:print          # print the canonical config (writes nothing)
 *   pnpm gcs:cors:write          # regenerate cors.json from the canonical config
 *   pnpm check:gcs-cors          # probe the LIVE bucket preflight (no credentials needed)
 *   pnpm gcs:cors:apply          # apply cors.json to the bucket (needs ADC)
 *
 * Why this exists: a bucket whose CORS allowlist is missing the app origin
 * takes doc intake down completely — every signed PUT is cancelled by the
 * browser before a byte is sent, and the UI can only report "upload failed".
 * `--check` turns that invisible infrastructure drift into a one-command,
 * credential-free answer.
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  UPLOAD_BROWSER_ORIGINS,
  UPLOAD_CORS_METHODS,
  UPLOAD_CORS_RESPONSE_HEADERS,
  buildBucketCorsConfig,
  type BucketCorsRule,
} from "@/lib/storage/uploadCorsConfig";

const CORS_FILE = path.join(process.cwd(), "cors.json");

function bucketName(): string {
  const bucket = process.env.GCS_BUCKET || process.env.GCS_UPLOAD_BUCKET;
  if (!bucket) {
    throw new Error(
      "GCS_BUCKET is not set. Export the uploads bucket name, e.g. GCS_BUCKET=buddy-the-underwriter-uploads",
    );
  }
  return bucket;
}

function serialized(): string {
  return `${JSON.stringify(buildBucketCorsConfig(), null, 2)}\n`;
}

async function writeCorsFile() {
  await writeFile(CORS_FILE, serialized(), "utf8");
  console.log(`wrote ${path.relative(process.cwd(), CORS_FILE)}`);
}

/**
 * Live preflight probe. Needs no GCP credentials: GCS answers OPTIONS for
 * anonymous callers, so this is exactly the request the browser makes.
 */
async function check(): Promise<number> {
  const bucket = bucketName();
  const probeUrl = `https://storage.googleapis.com/${bucket}/cors-preflight-probe`;
  const requestHeaders = UPLOAD_CORS_RESPONSE_HEADERS.join(",").toLowerCase();

  let failures = 0;

  for (const origin of UPLOAD_BROWSER_ORIGINS) {
    let res: Response;
    try {
      res = await fetch(probeUrl, {
        method: "OPTIONS",
        headers: {
          Origin: origin,
          "Access-Control-Request-Method": "PUT",
          "Access-Control-Request-Headers": requestHeaders,
        },
      });
    } catch (e: any) {
      failures++;
      console.error(`FAIL ${origin} — preflight request errored: ${e?.message ?? e}`);
      continue;
    }

    const allowOrigin = res.headers.get("access-control-allow-origin");
    const allowMethods = (res.headers.get("access-control-allow-methods") ?? "")
      .split(",")
      .map((m) => m.trim().toUpperCase())
      .filter(Boolean);
    const allowHeaders = (res.headers.get("access-control-allow-headers") ?? "")
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean);

    const originOk =
      allowOrigin === "*" || allowOrigin?.toLowerCase() === origin.toLowerCase();
    const missingMethods = UPLOAD_CORS_METHODS.filter((m) => !allowMethods.includes(m));
    const missingHeaders = UPLOAD_CORS_RESPONSE_HEADERS.filter(
      (h) => !allowHeaders.includes(h.toLowerCase()),
    );

    if (originOk && !missingMethods.length && !missingHeaders.length) {
      console.log(`OK   ${origin}`);
      continue;
    }

    failures++;
    if (!originOk) {
      console.error(
        `FAIL ${origin} — bucket returned no matching Access-Control-Allow-Origin ` +
          `(got ${allowOrigin ?? "none"}). Browser uploads from this origin are blocked.`,
      );
    }
    if (missingMethods.length) {
      console.error(`FAIL ${origin} — missing allowed methods: ${missingMethods.join(", ")}`);
    }
    if (missingHeaders.length) {
      console.error(`FAIL ${origin} — missing allowed headers: ${missingHeaders.join(", ")}`);
    }
  }

  if (failures) {
    console.error(
      `\n${failures} origin(s) blocked on gs://${bucket}. Fix with:\n` +
        `  pnpm gcs:cors:apply           # or\n` +
        `  gcloud storage buckets update gs://${bucket} --cors-file=cors.json`,
    );
    return 1;
  }

  console.log(`\nAll ${UPLOAD_BROWSER_ORIGINS.length} upload origins pass preflight on gs://${bucket}.`);
  return 0;
}

/**
 * Apply cors.json to the bucket using Application Default Credentials
 * (`gcloud auth application-default login`, or GOOGLE_APPLICATION_CREDENTIALS).
 * Vercel's Workload Identity path is request-scoped and not available to a
 * CLI, so this is deliberately an operator-run command.
 */
async function apply(): Promise<number> {
  const bucket = bucketName();
  const raw = await readFile(CORS_FILE, "utf8");
  const config = JSON.parse(raw) as BucketCorsRule[];

  const { Storage } = await import("@google-cloud/storage");
  const storage = new Storage({
    projectId:
      process.env.GCS_PROJECT_ID ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.GCP_PROJECT_ID ||
      undefined,
  });

  await storage.bucket(bucket).setCorsConfiguration(config as any);
  console.log(`applied cors.json to gs://${bucket}`);
  return check();
}

async function main() {
  const mode = process.argv[2] ?? "--print";

  switch (mode) {
    case "--print":
      process.stdout.write(serialized());
      return 0;
    case "--write":
      await writeCorsFile();
      return 0;
    case "--check":
      return check();
    case "--apply":
      return apply();
    default:
      console.error(`unknown mode: ${mode} (expected --print | --write | --check | --apply)`);
      return 2;
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((e) => {
    console.error(e?.message ?? e);
    process.exitCode = 1;
  });
