import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_VERTEX_LOCATION,
  getVertexApiHost,
  normalizeVertexLocation,
  resolveVertexLocation,
} from "@/lib/ai/vertexLocationValue";

test("defaults missing and blank locations to the supported regional endpoint", () => {
  assert.equal(normalizeVertexLocation(undefined), DEFAULT_VERTEX_LOCATION);
  assert.equal(normalizeVertexLocation(null), DEFAULT_VERTEX_LOCATION);
  assert.equal(normalizeVertexLocation("   "), DEFAULT_VERTEX_LOCATION);
});

test("preserves valid multi-region and global locations", () => {
  for (const [value, expected] of [
    ["us", "us"],
    [" US ", "us"],
    ["eu", "eu"],
    [" EU ", "eu"],
    ["global", "global"],
    [" GLOBAL ", "global"],
  ] as const) {
    assert.equal(normalizeVertexLocation(value), expected);
  }
});

test("rejects malformed and zonal values before endpoint construction", () => {
  for (const value of ["us_central1", "us-central1-a", "not-a-region", "123"]) {
    assert.equal(
      normalizeVertexLocation(value),
      DEFAULT_VERTEX_LOCATION,
      `${value} must not be interpolated into an API hostname`,
    );
  }
});

test("normalizes valid regional locations", () => {
  assert.equal(normalizeVertexLocation(" US-EAST1 "), "us-east1");
  assert.equal(normalizeVertexLocation("europe-west4"), "europe-west4");
  assert.equal(
    normalizeVertexLocation("northamerica-northeast1"),
    "northamerica-northeast1",
  );
});

test("GOOGLE_CLOUD_LOCATION takes precedence when it is nonblank", () => {
  assert.equal(resolveVertexLocation("us", "us-east1"), "us");
  assert.equal(
    resolveVertexLocation("europe-west4", "us-east1"),
    "europe-west4",
  );
});

test("a blank location falls through to GOOGLE_CLOUD_REGION", () => {
  assert.equal(resolveVertexLocation("  ", "eu"), "eu");
});

test("an invalid higher-priority location fails closed", () => {
  assert.equal(
    resolveVertexLocation("invalid!", "europe-west4"),
    DEFAULT_VERTEX_LOCATION,
  );
});

test("builds the documented hostname for every Vertex endpoint class", () => {
  assert.equal(
    getVertexApiHost("us"),
    "aiplatform.us.rep.googleapis.com",
  );
  assert.equal(
    getVertexApiHost("eu"),
    "aiplatform.eu.rep.googleapis.com",
  );
  assert.equal(
    getVertexApiHost("global"),
    "aiplatform.googleapis.com",
  );
  assert.equal(
    getVertexApiHost("us-central1"),
    "us-central1-aiplatform.googleapis.com",
  );
});

test("never builds the known-invalid multi-region-as-regional hostname", () => {
  for (const location of ["us", "eu", " US ", " EU "]) {
    assert.doesNotMatch(
      getVertexApiHost(location),
      /^(us|eu)-aiplatform\.googleapis\.com$/,
    );
  }
});

test("host and request-path location stay paired", () => {
  const buildUrl = (configured: string) => {
    const location = normalizeVertexLocation(configured);
    const host = getVertexApiHost(location);
    return `https://${host}/v1/projects/project/locations/${location}`;
  };

  assert.equal(
    buildUrl("us"),
    "https://aiplatform.us.rep.googleapis.com/v1/projects/project/locations/us",
  );
  assert.equal(
    buildUrl("global"),
    "https://aiplatform.googleapis.com/v1/projects/project/locations/global",
  );
});
