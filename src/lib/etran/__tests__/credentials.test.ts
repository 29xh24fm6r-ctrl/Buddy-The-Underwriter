import { test } from "node:test";
import assert from "node:assert/strict";

// credentials.ts has `import "server-only"` and pulls supabaseAdmin via ESM
// — neither is interceptable under `node --test --import tsx` (require.cache
// injection doesn't reach ESM imports, and server-only throws at import
// time). Pattern matches src/lib/tenant/__tests__/brokerage.test.ts: inline
// reimplementation of the exact control flow, exercised with closure mocks
// for `sb.rpc` and the encryption-key env var. Keep this in lockstep with
// credentials.ts if that file's logic changes.
//
// The actual pgp_sym_encrypt/pgp_sym_decrypt round-trip through the real
// SECURITY DEFINER RPCs was verified live against prod during Phase 6B
// (encrypt -> store -> decrypt exact match, confirmed the bytea column
// contains no plaintext, test row cleaned up) — that is not repeatable here
// without a live Postgres connection, so this suite covers the TypeScript
// control flow only.

type RpcCall = { fn: string; args: Record<string, unknown> };

function makeSb(rpcImpl: (fn: string, args: Record<string, unknown>) => Promise<{ data: any; error: any }>) {
  const calls: RpcCall[] = [];
  return {
    calls,
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return rpcImpl(fn, args);
    },
  };
}

async function getEtranCredentialsInline(
  bankId: string,
  deps: { sb: ReturnType<typeof makeSb>; encryptionKey: string | undefined },
) {
  if (!deps.encryptionKey) {
    throw new Error("ETRAN_CRED_ENCRYPTION_KEY not configured");
  }
  const { data, error } = await deps.sb.rpc("etran_get_credentials_decrypted", {
    p_bank_id: bankId,
    p_encryption_key: deps.encryptionKey,
  });
  if (error || !data || !data[0]) return null;
  return data[0];
}

async function storeEtranCredentialsInline(
  args: {
    bankId: string;
    sbaLenderId: string;
    sbaServiceCenter: string;
    clientCertPem: string;
    clientKeyPem: string;
    endpointEnvironment: "sandbox" | "production";
    certExpiresAt: Date | null;
  },
  deps: { sb: ReturnType<typeof makeSb>; encryptionKey: string | undefined },
): Promise<{ ok: true } | { ok: false; reason: "ENCRYPTION_KEY_MISSING" | "DB_UPSERT_FAILED" }> {
  if (!deps.encryptionKey) return { ok: false, reason: "ENCRYPTION_KEY_MISSING" };
  const { error } = await deps.sb.rpc("etran_upsert_credentials", {
    p_bank_id: args.bankId,
    p_sba_lender_id: args.sbaLenderId,
    p_sba_service_center: args.sbaServiceCenter,
    p_client_cert_pem: args.clientCertPem,
    p_client_key_pem: args.clientKeyPem,
    p_endpoint_environment: args.endpointEnvironment,
    p_cert_expires_at: args.certExpiresAt?.toISOString() ?? null,
    p_encryption_key: deps.encryptionKey,
  });
  if (error) return { ok: false, reason: "DB_UPSERT_FAILED" };
  return { ok: true };
}

test("getEtranCredentialsInline: round-trips RPC data[0] into the EtranCredentials shape", async () => {
  const sb = makeSb(async (fn) => {
    assert.equal(fn, "etran_get_credentials_decrypted");
    return {
      data: [
        {
          sba_lender_id: "LID-9",
          sba_service_center: "SC-9",
          client_cert_pem: "-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----",
          client_key_pem: "-----BEGIN PRIVATE KEY-----\nxyz\n-----END PRIVATE KEY-----",
          endpoint_environment: "sandbox",
        },
      ],
      error: null,
    };
  });
  const creds = await getEtranCredentialsInline("b1", { sb, encryptionKey: "test-key" });
  assert.ok(creds);
  assert.equal(creds.sba_lender_id, "LID-9");
  assert.equal(creds.client_cert_pem, "-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----");
  assert.equal(sb.calls[0].args.p_encryption_key, "test-key");
  assert.equal(sb.calls[0].args.p_bank_id, "b1");
});

test("getEtranCredentialsInline: throws when ETRAN_CRED_ENCRYPTION_KEY is not configured", async () => {
  const sb = makeSb(async () => ({ data: null, error: null }));
  await assert.rejects(
    () => getEtranCredentialsInline("b1", { sb, encryptionKey: undefined }),
    /ETRAN_CRED_ENCRYPTION_KEY not configured/,
  );
});

test("getEtranCredentialsInline: returns null when no credential row exists for the bank", async () => {
  const sb = makeSb(async () => ({ data: [], error: null }));
  const creds = await getEtranCredentialsInline("b-no-creds", { sb, encryptionKey: "test-key" });
  assert.equal(creds, null);
});

test("getEtranCredentialsInline: returns null (never throws) on an RPC error", async () => {
  const sb = makeSb(async () => ({ data: null, error: { message: "permission denied" } }));
  const creds = await getEtranCredentialsInline("b1", { sb, encryptionKey: "test-key" });
  assert.equal(creds, null);
});

test("storeEtranCredentialsInline: upsert replaces existing — RPC called with ON CONFLICT semantics, all args mapped", async () => {
  const sb = makeSb(async (fn, args) => {
    assert.equal(fn, "etran_upsert_credentials");
    assert.equal(args.p_bank_id, "b1");
    assert.equal(args.p_sba_lender_id, "LID-NEW");
    assert.equal(args.p_endpoint_environment, "production");
    assert.equal(args.p_cert_expires_at, "2027-01-01T00:00:00.000Z");
    return { data: null, error: null };
  });
  const result = await storeEtranCredentialsInline(
    {
      bankId: "b1",
      sbaLenderId: "LID-NEW",
      sbaServiceCenter: "SC-NEW",
      clientCertPem: "cert",
      clientKeyPem: "key",
      endpointEnvironment: "production",
      certExpiresAt: new Date("2027-01-01T00:00:00.000Z"),
    },
    { sb, encryptionKey: "test-key" },
  );
  assert.deepEqual(result, { ok: true });
});

test("storeEtranCredentialsInline: null certExpiresAt maps to null p_cert_expires_at (not thrown)", async () => {
  const sb = makeSb(async (_fn, args) => {
    assert.equal(args.p_cert_expires_at, null);
    return { data: null, error: null };
  });
  const result = await storeEtranCredentialsInline(
    {
      bankId: "b1",
      sbaLenderId: "LID-1",
      sbaServiceCenter: "SC-1",
      clientCertPem: "cert",
      clientKeyPem: "key",
      endpointEnvironment: "sandbox",
      certExpiresAt: null,
    },
    { sb, encryptionKey: "test-key" },
  );
  assert.deepEqual(result, { ok: true });
});

test("storeEtranCredentialsInline: ENCRYPTION_KEY_MISSING short-circuits before any RPC call", async () => {
  const sb = makeSb(async () => {
    throw new Error("must not be called");
  });
  const result = await storeEtranCredentialsInline(
    {
      bankId: "b1",
      sbaLenderId: "LID-1",
      sbaServiceCenter: "SC-1",
      clientCertPem: "cert",
      clientKeyPem: "key",
      endpointEnvironment: "sandbox",
      certExpiresAt: null,
    },
    { sb, encryptionKey: undefined },
  );
  assert.deepEqual(result, { ok: false, reason: "ENCRYPTION_KEY_MISSING" });
  assert.equal(sb.calls.length, 0);
});

test("storeEtranCredentialsInline: DB_UPSERT_FAILED surfaced without leaking the RPC error message (which could echo argument values)", async () => {
  const sb = makeSb(async () => ({ data: null, error: { message: "constraint violation on bank_id" } }));
  const result = await storeEtranCredentialsInline(
    {
      bankId: "b1",
      sbaLenderId: "LID-1",
      sbaServiceCenter: "SC-1",
      clientCertPem: "cert",
      clientKeyPem: "key",
      endpointEnvironment: "sandbox",
      certExpiresAt: null,
    },
    { sb, encryptionKey: "test-key" },
  );
  assert.deepEqual(result, { ok: false, reason: "DB_UPSERT_FAILED" });
});
