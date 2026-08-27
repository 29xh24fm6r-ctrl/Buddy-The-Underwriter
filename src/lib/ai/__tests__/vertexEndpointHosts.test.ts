/**
 * Vertex endpoint host construction — regional vs multi-region vs global.
 *
 * Runs under the `react-server` export condition (see REACT_SERVER_ONLY in
 * scripts/discover-tests.mjs) so vertexLocation.ts's `import "server-only"`
 * resolves to the package's empty stub instead of throwing.
 *
 * Regression: providers/google.ts built `${location}-aiplatform.googleapis.com`
 * for every location. Production runs GOOGLE_CLOUD_LOCATION="us" — a valid
 * multi-region (REP) location — so every Vertex call went to the non-existent
 * host `us-aiplatform.googleapis.com` and returned
 * `400 Invalid hostname: us-aiplatform.googleapis.com`, stalling document
 * extraction app-wide. Same bug class as vercel/ai#15722 and litellm#25926.
 *
 * Expected shapes are taken from Google's own documentation:
 *   multi-region: https://aiplatform.us.rep.googleapis.com/v1/projects/{P}/locations/us/...
 *     cloud.google.com/blog/products/ai-machine-learning/multi-region-endpoints-for-claude-available-on-vertex-ai
 *   global:       https://aiplatform.googleapis.com/v1/projects/{P}/locations/global/...
 *   regional:     https://us-central1-aiplatform.googleapis.com/v1/projects/{P}/locations/us-central1/...
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  getVertexApiHost,
  getVertexLocation,
  VERTEX_MULTI_REGIONS,
} from "../vertexLocation";

const LOCATION = "GOOGLE_CLOUD_LOCATION";
const REGION = "GOOGLE_CLOUD_REGION";

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const prior: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    prior[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(prior)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("multi-region locations use the REP host, not the regional shape", () => {
  assert.equal(getVertexApiHost("us"), "aiplatform.us.rep.googleapis.com");
  assert.equal(getVertexApiHost("eu"), "aiplatform.eu.rep.googleapis.com");
  for (const mr of VERTEX_MULTI_REGIONS) {
    assert.notEqual(
      getVertexApiHost(mr),
      `${mr}-aiplatform.googleapis.com`,
      `${mr} must not build the invalid regional-shaped host`,
    );
  }
});

test("the global location uses the bare host", () => {
  assert.equal(getVertexApiHost("global"), "aiplatform.googleapis.com");
});

test("regional locations keep the REGION-aiplatform shape", () => {
  for (const region of [
    "us-central1",
    "us-east5",
    "europe-west4",
    "asia-northeast1",
    "me-west1",
  ]) {
    assert.equal(getVertexApiHost(region), `${region}-aiplatform.googleapis.com`);
  }
});

test("casing and whitespace are tolerated", () => {
  assert.equal(getVertexApiHost(" US "), "aiplatform.us.rep.googleapis.com");
  assert.equal(getVertexApiHost("Us-Central1"), "us-central1-aiplatform.googleapis.com");
  assert.equal(getVertexApiHost("  global\n"), "aiplatform.googleapis.com");
});

test("no location produces the known-invalid multi-region-as-regional host", () => {
  for (const loc of ["us", "eu", "US", " eu "]) {
    const host = getVertexApiHost(loc);
    assert.doesNotMatch(
      host,
      /^(us|eu)-aiplatform\.googleapis\.com$/,
      `"${loc}" produced the invalid host ${host}`,
    );
  }
});

test("getVertexLocation resolves the env chain without rewriting the value", () => {
  // The operator's location is a data-residency choice. It is normalized for
  // formatting only — never substituted for a different location.
  withEnv({ [LOCATION]: "us", [REGION]: undefined }, () => {
    assert.equal(getVertexLocation(), "us");
  });
  withEnv({ [LOCATION]: " EU ", [REGION]: undefined }, () => {
    assert.equal(getVertexLocation(), "eu");
  });
  withEnv({ [LOCATION]: undefined, [REGION]: "europe-west4" }, () => {
    assert.equal(getVertexLocation(), "europe-west4");
  });
  withEnv({ [LOCATION]: "us-central1", [REGION]: "eu" }, () => {
    assert.equal(getVertexLocation(), "us-central1", "LOCATION takes precedence");
  });
  withEnv({ [LOCATION]: undefined, [REGION]: undefined }, () => {
    assert.equal(getVertexLocation(), "us-central1", "default");
  });
});

test("host and path segment stay consistent for every location class", () => {
  const project = "proj";
  const model = "gemini-2.0-flash";
  const build = (loc: string) =>
    `https://${getVertexApiHost(loc)}/v1/projects/${project}` +
    `/locations/${loc}/publishers/google/models/${model}:generateContent`;

  assert.equal(
    build("us"),
    `https://aiplatform.us.rep.googleapis.com/v1/projects/proj/locations/us/publishers/google/models/${model}:generateContent`,
  );
  assert.equal(
    build("global"),
    `https://aiplatform.googleapis.com/v1/projects/proj/locations/global/publishers/google/models/${model}:generateContent`,
  );
  assert.equal(
    build("us-central1"),
    `https://us-central1-aiplatform.googleapis.com/v1/projects/proj/locations/us-central1/publishers/google/models/${model}:generateContent`,
  );
});
