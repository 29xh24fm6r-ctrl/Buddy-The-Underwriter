import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  requireTwilioWebhookPersistence,
  TwilioWebhookPersistenceError,
} from "../twilioWebhookPersistence";

test("allows a webhook acknowledgement after a successful durable write", () => {
  assert.doesNotThrow(() => requireTwilioWebhookPersistence(null, "persist opt-out"));
});

test("throws a typed error when a durable write fails", () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    assert.throws(
      () =>
        requireTwilioWebhookPersistence(
          { code: "08006", message: "connection failure" },
          "persist opt-out",
        ),
      (error: unknown) => {
        assert.ok(error instanceof TwilioWebhookPersistenceError);
        assert.equal(error.code, "TWILIO_WEBHOOK_PERSISTENCE_FAILED");
        assert.equal(error.operation, "persist opt-out");
        return true;
      },
    );
  } finally {
    console.error = originalError;
  }
});

test("inbound webhook gates every borrower message and consent transition on persistence", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src/app/api/webhooks/twilio/inbound/route.ts"),
    "utf8",
  );

  for (const variable of ["inboundErr", "optOutErr", "optInErr", "helpErr"]) {
    assert.match(
      source,
      new RegExp(`requireTwilioWebhookPersistence\\(${variable},`),
      `${variable} must prevent a false-success webhook acknowledgement`,
    );
  }
});

test("status webhook gates lookup and delivery-event writes on persistence", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src/app/api/webhooks/twilio/status/route.ts"),
    "utf8",
  );

  assert.match(
    source,
    /requireTwilioWebhookPersistence\(outboundLookupError,/,
  );
  assert.match(
    source,
    /requireTwilioWebhookPersistence\(error, "persist delivery status"\)/,
  );
});

test("phone resolution distinguishes database failure from no match", () => {
  const legacyResolver = fs.readFileSync(
    path.join(process.cwd(), "src/lib/sms/resolve.ts"),
    "utf8",
  );
  const linkResolver = fs.readFileSync(
    path.join(process.cwd(), "src/lib/sms/phoneLinks.ts"),
    "utf8",
  );

  assert.match(legacyResolver, /if \(portalErr\)[\s\S]*throw new Error/);
  assert.match(legacyResolver, /if \(dealErr\)[\s\S]*throw new Error/);
  assert.match(legacyResolver, /if \(dealsErr\)[\s\S]*throw new Error/);
  assert.match(
    linkResolver,
    /resolveByPhone error:[\s\S]*resolveByPhone failed:/,
  );
});
