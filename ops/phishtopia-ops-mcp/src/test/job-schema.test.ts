import assert from "node:assert/strict";
import test from "node:test";

import { ACTION_NAMES } from "../constants.js";
import {
  ActionSchema,
  JobIdInputSchema,
  JobOutputSchema,
  StartJobInputSchema,
} from "../schema.js";

const commit = "a".repeat(40);
const digest = "b".repeat(64);

const actions = [
  { type: "upgrade_ops_release", commit, artifactSha256: digest },
  { type: "deploy_verified_release", commit, artifactSha256: digest },
  { type: "restart_phishtopia_service", service: "phishtopia_app" },
  { type: "rollback_release", target: "phishtopia_ops", release: commit },
  {
    type: "canary_and_promote",
    revision: "phishtopia-00041-pqc",
    percentages: [5, 25, 100],
  },
  {
    type: "run_tested_migration",
    commit,
    artifactSha256: digest,
    migrationId: "20260718000000_bootstrap",
  },
  { type: "rotate_session_secret", secret: "phishtopia-session-secret" },
  {
    type: "update_dns_with_rollback",
    hostname: "phishtopia.com",
    recordType: "A",
    value: "34.73.92.179",
    ttl: 300,
  },
] as const;

test("all eight action schemas are exact and accepted", () => {
  assert.deepEqual(
    actions.map((action) => ActionSchema.parse(action).type).sort(),
    [...ACTION_NAMES].sort(),
  );
});

test("canary requires an actual gradual stage at or below ten percent", () => {
  for (const percentages of [[100], [25, 100]]) {
    assert.equal(
      ActionSchema.safeParse({ ...actions[4], percentages }).success,
      false,
    );
  }
});

test("DNS record shapes are bound to their exact production hostname", () => {
  assert.equal(
    ActionSchema.safeParse({
      ...actions[7],
      hostname: "www.phishtopia.com",
    }).success,
    false,
  );
  assert.equal(
    ActionSchema.safeParse({
      ...actions[7],
      hostname: "phishtopia.com",
      recordType: "CNAME",
      value: "phishtopia-ht3gdpkzmq-ue.a.run.app",
    }).success,
    false,
  );
});

test("pre-mutation semantic failures remain parseable", () => {
  assert.equal(
    JobOutputSchema.safeParse({
      jobId: "12345678-1234-4123-8123-123456789abc",
      action: "rollback_release",
      state: "failed",
      progress: 100,
      createdAt: "2026-07-18T00:00:00.000Z",
      updatedAt: "2026-07-18T00:00:01.000Z",
      deadlineAt: "2026-07-18T00:10:00.000Z",
      resultCode: "failed_without_mutation",
      observations: [{ name: "rollback", value: "not_required" }],
    }).success,
    true,
  );
});

test("start_job requires a bounded idempotency key and rejects extra capabilities", () => {
  assert.equal(
    StartJobInputSchema.safeParse({
      idempotencyKey: "release-0001",
      action: actions[0],
    }).success,
    true,
  );
  for (const field of ["command", "path", "url", "sql", "payload", "headers"]) {
    assert.equal(
      StartJobInputSchema.safeParse({
        idempotencyKey: "release-0001",
        action: { ...actions[0], [field]: "forbidden" },
      }).success,
      false,
      field,
    );
  }
});

test("injection-shaped identifiers and arbitrary job ids are rejected", () => {
  assert.equal(
    ActionSchema.safeParse({ ...actions[0], commit: `${"a".repeat(39)};` })
      .success,
    false,
  );
  assert.equal(
    ActionSchema.safeParse({ ...actions[4], revision: "latest" }).success,
    false,
  );
  assert.equal(
    ActionSchema.safeParse({
      ...actions[5],
      migrationId: "20260718000000_x;DROP",
    }).success,
    false,
  );
  assert.equal(
    ActionSchema.safeParse({ ...actions[7], hostname: "attacker.example" })
      .success,
    false,
  );
  assert.equal(
    ActionSchema.safeParse({ ...actions[7], value: "34.73.92.180" }).success,
    false,
  );
  assert.equal(
    ActionSchema.safeParse({
      ...actions[7],
      recordType: "AAAA",
      value: "2606:4700::1111",
    }).success,
    false,
  );
  assert.equal(
    JobIdInputSchema.safeParse({ jobId: "../jobs.sqlite3" }).success,
    false,
  );
});
