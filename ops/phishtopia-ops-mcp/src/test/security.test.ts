import assert from "node:assert/strict";
import test from "node:test";

import { assertReadOnlyGcloudArgs } from "../google.js";
import { NoArgsSchema, SecretMetadataInputSchema } from "../schema.js";
import { redact } from "../sanitize.js";

test("fixed Google commands require the Phishtopia project and reject mutations", () => {
  assert.doesNotThrow(() =>
    assertReadOnlyGcloudArgs([
      "run",
      "services",
      "describe",
      "phishtopia",
      "--project=project-43a8be4b-69a7-4d52-805",
    ]),
  );
  assert.throws(() =>
    assertReadOnlyGcloudArgs(["run", "services", "describe", "phishtopia"]),
  );
  assert.throws(() =>
    assertReadOnlyGcloudArgs([
      "secrets",
      "versions",
      "access",
      "1",
      "--project=project-43a8be4b-69a7-4d52-805",
    ]),
  );
  assert.throws(() =>
    assertReadOnlyGcloudArgs([
      "run",
      "services",
      "update-traffic",
      "phishtopia",
      "--project=project-43a8be4b-69a7-4d52-805",
    ]),
  );
});

test("tool schemas reject unexpected arguments and secret payload-shaped input", () => {
  assert.equal(NoArgsSchema.safeParse({}).success, true);
  assert.equal(
    NoArgsSchema.safeParse({ command: "gcloud projects list" }).success,
    false,
  );
  assert.equal(
    SecretMetadataInputSchema.safeParse({ secret: "phishtopia-session-secret" })
      .success,
    true,
  );
  assert.equal(
    SecretMetadataInputSchema.safeParse({ secret: "other-secret" }).success,
    false,
  );
  assert.equal(
    SecretMetadataInputSchema.safeParse({
      secret: "phishtopia-database-url",
      payload: "forbidden",
    }).success,
    false,
  );
});

test("redaction removes credentials, connection fields, identities, and IP addresses", () => {
  const raw =
    "postgresql://appuser:password@db.example.test:5432/phishtopia token=abc owner@example.test 34.73.92.179";
  const sanitized = redact(raw);
  assert.match(sanitized, /\[redacted-connection\]/);
  assert.match(sanitized, /\[redacted-email\]/);
  assert.match(sanitized, /\[redacted-ip\]/);
  assert.doesNotMatch(
    sanitized,
    /appuser|password|db\.example|abc|owner@example|34\.73/,
  );
});
