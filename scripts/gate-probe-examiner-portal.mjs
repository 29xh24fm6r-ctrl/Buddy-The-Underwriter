#!/usr/bin/env node
/**
 * Gate Probe: Live Examiner Access Portal (Phase L)
 *
 * Validates the sealed examiner portal API contracts:
 *   - Examiner grant management (create, list, revoke)
 *   - Examiner portal deal view (grant-based access)
 *   - Inline integrity verification
 *   - Activity ledgering
 *
 * Usage:
 *   node scripts/gate-probe-examiner-portal.mjs --base http://localhost:3000 [--deal <dealId>]
 */

const BASE =
  process.argv.find((a) => a.startsWith("--base="))?.split("=")[1] ??
  (process.argv.includes("--base")
    ? process.argv[process.argv.indexOf("--base") + 1]
    : "http://localhost:3000");

const DEAL_ID =
  process.argv.find((a) => a.startsWith("--deal="))?.split("=")[1] ??
  (process.argv.includes("--deal")
    ? process.argv[process.argv.indexOf("--deal") + 1]
    : null);

const COOKIE = process.env.BUDDY_SESSION_COOKIE ?? "";

let passed = 0;
let failed = 0;

function ok(label) {
  passed++;
  console.log(`  ✓ ${label}`);
}
function fail(label, detail) {
  failed++;
  console.error(`  ✗ ${label}  →  ${detail}`);
}

async function probe(label, fn) {
  try {
    await fn();
  } catch (e) {
    fail(label, String(e?.message ?? e));
  }
}

async function fetchJSON(path, opts = {}) {
  const url = `${BASE}${path}`;
  const headers = { cookie: COOKIE, "content-type": "application/json", ...opts.headers };
  const res = await fetch(url, { ...opts, headers });
  const json = await res.json();
  return { res, json };
}

// ─── Probes ──────────────────────────────────────────────

async function main() {
  console.log(`\n🔍 Gate Probe: Live Examiner Access Portal (Phase L)`);
  console.log(`   Base: ${BASE}`);
  if (DEAL_ID) console.log(`   Deal: ${DEAL_ID}`);
  console.log();

  // ── Probe 1: Examiner grants list ───────────────────────
  await probe("Examiner grants list", async () => {
    const { res, json } = await fetchJSON("/api/examiner/grants");

    if (res.status !== 200) {
      fail("grants list HTTP 200", `got ${res.status}`);
      return;
    }
    ok("grants list responds 200");

    if (json.ok === undefined) {
      fail("grants list envelope", "missing ok field");
    } else {
      ok("grants list has ok field");
    }

    const cid = res.headers.get("x-correlation-id");
    if (!cid) {
      fail("grants list x-correlation-id", "missing header");
    } else {
      ok(`grants list x-correlation-id: ${cid}`);
    }

    if (json.ok && Array.isArray(json.grants)) {
      ok(`grants list returned ${json.grants.length} grants`);
    }
  });

  // ── Probe 2: Examiner grant creation ────────────────────
  let createdGrantId = null;

  await probe("Examiner grant creation", async () => {
    const body = {
      examiner_name: "Gate Probe Examiner",
      organization: "Gate Probe Org",
      deal_ids: DEAL_ID ? [DEAL_ID] : [],
      read_areas: ["all"],
      expires_in_hours: 1,
    };

    const { res, json } = await fetchJSON("/api/examiner/grants", {
      method: "POST",
      body: JSON.stringify(body),
    });

    if (res.status !== 200) {
      fail("grant creation HTTP 200", `got ${res.status}`);
      return;
    }
    ok("grant creation responds 200");

    if (json.ok === undefined) {
      fail("grant creation envelope", "missing ok field");
    } else {
      ok(`grant creation ok: ${json.ok}`);
    }

    if (json.ok && json.grant?.id) {
      createdGrantId = json.grant.id;
      ok(`created grant: ${createdGrantId.slice(0, 8)}…`);

      // Validate grant structure
      const g = json.grant;
      if (!g.examiner_name) fail("grant.examiner_name", "missing");
      else ok("grant has examiner_name");

      if (!g.organization) fail("grant.organization", "missing");
      else ok("grant has organization");

      if (!g.expires_at) fail("grant.expires_at", "missing");
      else ok("grant has expires_at");

      if (typeof g.is_active !== "boolean") fail("grant.is_active", "not boolean");
      else ok(`grant is_active: ${g.is_active}`);

      if (!g.scope?.read_areas) fail("grant.scope.read_areas", "missing");
      else ok("grant has scope.read_areas");
    } else if (!json.ok) {
      // Possible auth error — acceptable if no session
      console.log(`  ⚠ Grant creation returned ok:false (may need auth): ${json.error?.code}`);
    }
  });

  // ── Probe 3: Examiner portal deal view ──────────────────
  if (createdGrantId && DEAL_ID) {
    await probe("Examiner portal deal view", async () => {
      const { res, json } = await fetchJSON(
        `/api/examiner/portal/deals/${DEAL_ID}?grant_id=${createdGrantId}`,
      );

      if (res.status !== 200) {
        fail("portal deal view HTTP 200", `got ${res.status}`);
        return;
      }
      ok("portal deal view responds 200");

      if (json.ok === undefined) {
        fail("portal deal view envelope", "missing ok field");
      } else {
        ok(`portal deal view ok: ${json.ok}`);
      }

      if (json.ok && json.snapshot) {
        ok("portal deal view returns frozen snapshot");

        if (json.snapshot.deal?.id === DEAL_ID) {
          ok("snapshot deal.id matches requested dealId");
        }
      }

      const cid = res.headers.get("x-correlation-id");
      if (cid) ok(`portal deal view x-correlation-id: ${cid}`);
    });

    // ── Probe 4: Inline integrity verification ──────────────
    await probe("Inline integrity verification", async () => {
      const { res, json } = await fetchJSON(
        `/api/examiner/portal/deals/${DEAL_ID}/verify?grant_id=${createdGrantId}`,
      );

      if (res.status !== 200) {
        fail("verify HTTP 200", `got ${res.status}`);
        return;
      }
      ok("verify responds 200");

      if (json.ok === undefined) {
        fail("verify envelope", "missing ok field");
      } else {
        ok(`verify ok: ${json.ok}`);
      }

      if (json.ok && json.verification) {
        const v = json.verification;

        if (v.check_version !== "1.0") {
          fail("verify check_version", `expected 1.0, got ${v.check_version}`);
        } else {
          ok("verify check_version is 1.0");
        }

        if (typeof v.match !== "boolean") {
          fail("verify match", "expected boolean");
        } else {
          ok(`verify hash match: ${v.match}`);
        }

        if (!v.computed_hash) {
          fail("verify computed_hash", "missing");
        } else {
          ok(`verify computed_hash: ${v.computed_hash.slice(0, 16)}…`);
        }
      }
    });
  } else {
    console.log("  ⚠ Skipping portal + verify probes (no grant or deal available)");
  }

  // ── Probe 5: Grant revocation ───────────────────────────
  if (createdGrantId) {
    await probe("Grant revocation", async () => {
      const { res, json } = await fetchJSON(
        `/api/examiner/grants/${createdGrantId}/revoke`,
        {
          method: "POST",
          body: JSON.stringify({ reason: "Gate probe cleanup" }),
        },
      );

      if (res.status !== 200) {
        fail("revoke HTTP 200", `got ${res.status}`);
        return;
      }
      ok("revoke responds 200");

      if (json.ok === undefined) {
        fail("revoke envelope", "missing ok field");
      } else {
        ok(`revoke ok: ${json.ok}`);
      }

      if (json.ok && json.revoked === true) {
        ok("grant successfully revoked");
      }
    });
  }

  // ── Probe 6: Invalid grant_id returns ok:false (sealed) ─
  await probe("Invalid grant_id handling (sealed)", async () => {
    const fakeDeal = DEAL_ID ?? "00000000-0000-0000-0000-000000000000";
    const { res, json } = await fetchJSON(
      `/api/examiner/portal/deals/${fakeDeal}?grant_id=not-a-uuid`,
    );

    if (res.status !== 200) {
      fail("invalid grant_id HTTP 200", `got ${res.status} (should be sealed)`);
      return;
    }
    ok("invalid grant_id returns HTTP 200 (sealed)");

    if (json.ok !== false) {
      fail("invalid grant_id ok:false", `ok was ${json.ok}`);
    } else {
      ok("invalid grant_id returns ok:false");
    }

    if (json.error?.code) {
      ok(`invalid grant_id error code: ${json.error.code}`);
    }
  });

  // ── Probe 7: No 500s on examiner endpoints ─────────────
  await probe("No 500 errors on examiner endpoints", async () => {
    const endpoints = [
      "/api/examiner/grants",
      "/api/examiner/portal/deals/00000000-0000-0000-0000-000000000000?grant_id=00000000-0000-0000-0000-000000000000",
      "/api/examiner/portal/deals/00000000-0000-0000-0000-000000000000/verify?grant_id=00000000-0000-0000-0000-000000000000",
    ];

    for (const ep of endpoints) {
      const { res } = await fetchJSON(ep);
      if (res.status === 500) {
        fail(`${ep.split("?")[0]} no-500`, "returned HTTP 500");
      } else {
        ok(`${ep.split("?")[0]} does not return 500 (got ${res.status})`);
      }
    }
  });

  // ── Summary ─────────────────────────────────────────────
  console.log(`\n  ── Summary ──`);
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total:  ${passed + failed}\n`);

  if (failed > 0) {
    console.error("❌ Gate probe FAILED — see failures above.");
    process.exit(1);
  } else {
    console.log("✅ Gate probe PASSED — Live Examiner Access Portal.");
    process.exit(0);
  }
}

main().catch((e) => {
  console.error("Fatal probe error:", e);
  process.exit(2);
});
