/**
 * Behavioural tests for getVertexLocation()'s env-var normalization.
 *
 * Runs under the `react-server` export condition (see REACT_SERVER_ONLY in
 * scripts/discover-tests.mjs) so vertexLocation.ts's `import "server-only"`
 * resolves to the package's empty stub instead of throwing.
 *
 * Regression: production had GOOGLE_CLOUD_LOCATION="us". The helper returned
 * it verbatim and providers/google.ts interpolated it into
 * `https://${location}-aiplatform.googleapis.com`, yielding the non-existent
 * host `us-aiplatform.googleapis.com`. Every Vertex call 400'd, which stalled
 * document extraction across the app.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  getVertexLocation,
  __resetVertexLocationWarningForTests,
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
  __resetVertexLocationWarningForTests();
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(prior)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    __resetVertexLocationWarningForTests();
  }
}

test("multi-region values normalize to a real regional endpoint", () => {
  const cases: [string, string][] = [
    ["us", "us-central1"], // the exact production misconfiguration
    ["eu", "europe-west4"],
    ["europe", "europe-west4"],
    ["asia", "asia-northeast1"],
    ["global", "us-central1"],
  ];
  for (const [configured, expected] of cases) {
    withEnv({ [LOCATION]: configured, [REGION]: undefined }, () => {
      assert.equal(getVertexLocation(), expected, `${configured} should map to ${expected}`);
    });
  }
});

test("valid regional locations pass through untouched", () => {
  for (const region of [
    "us-central1",
    "us-east5",
    "europe-west4",
    "asia-northeast1",
    "me-west1",
  ]) {
    withEnv({ [LOCATION]: region, [REGION]: undefined }, () => {
      assert.equal(getVertexLocation(), region);
    });
  }
});

test("casing and surrounding whitespace are tolerated", () => {
  for (const raw of [" us ", "US", "Us-Central1", "  us-central1\n"]) {
    withEnv({ [LOCATION]: raw, [REGION]: undefined }, () => {
      assert.equal(getVertexLocation(), "us-central1", `${JSON.stringify(raw)}`);
    });
  }
});

test("an unrecognized value degrades to the default rather than a bad host", () => {
  withEnv({ [LOCATION]: "not-a-region!", [REGION]: undefined }, () => {
    assert.equal(getVertexLocation(), "us-central1");
  });
});

test("falls back through GOOGLE_CLOUD_REGION, then to us-central1", () => {
  withEnv({ [LOCATION]: undefined, [REGION]: "us" }, () => {
    assert.equal(getVertexLocation(), "us-central1");
  });
  withEnv({ [LOCATION]: undefined, [REGION]: "europe-west4" }, () => {
    assert.equal(getVertexLocation(), "europe-west4");
  });
  withEnv({ [LOCATION]: undefined, [REGION]: undefined }, () => {
    assert.equal(getVertexLocation(), "us-central1");
  });
});

test("the resolved location never builds a multi-region Vertex hostname", () => {
  for (const configured of ["us", "eu", "asia", "global", "", "nonsense"]) {
    withEnv({ [LOCATION]: configured, [REGION]: undefined }, () => {
      const host = `${getVertexLocation()}-aiplatform.googleapis.com`;
      assert.doesNotMatch(
        host,
        /^(us|eu|europe|asia|global)-aiplatform\.googleapis\.com$/,
        `configured "${configured}" produced invalid host ${host}`,
      );
      assert.match(host, /^[a-z]+-[a-z]+\d+-aiplatform\.googleapis\.com$/);
    });
  }
});
