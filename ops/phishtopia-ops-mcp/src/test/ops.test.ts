import assert from "node:assert/strict";
import test from "node:test";

import type { CommandResult, CommandRunner } from "../command.js";
import { MAX_LOG_ENTRIES, PROJECT_ID, VM_NAME, ZONE } from "../constants.js";
import { PhishtopiaOps, type HealthClient } from "../google.js";
import { ToolOutputSchema } from "../schema.js";

class MockRunner implements CommandRunner {
  readonly calls: Array<{ file: string; args: readonly string[] }> = [];

  async run(
    file: string,
    args: readonly string[],
    _timeoutMs: number,
  ): Promise<CommandResult> {
    this.calls.push({ file, args });
    const command = args.join(" ");
    if (command.includes("compute instances describe")) {
      return {
        stdout: JSON.stringify({
          status: "RUNNING",
          machineType: "https://example/e2-micro",
          serviceAccounts: [{}],
        }),
        exitCode: 0,
      };
    }
    if (command.includes("logging read")) {
      return {
        stdout: JSON.stringify(
          Array.from({ length: MAX_LOG_ENTRIES + 2 }, () => ({
            textPayload:
              "password authentication failed for user=private-user at 10.0.0.1",
          })),
        ),
        exitCode: 0,
      };
    }
    if (command.includes("storage objects list")) {
      return {
        stdout: JSON.stringify([
          {
            update_time: "2026-07-17T00:00:00Z",
            size: 123,
            crc32c_hash: "present",
          },
        ]),
        exitCode: 0,
      };
    }
    if (command.includes("secrets describe")) {
      return {
        stdout: JSON.stringify({ createTime: "2026-07-17T00:00:00Z" }),
        exitCode: 0,
      };
    }
    if (command.includes("secrets versions list")) {
      return {
        stdout: JSON.stringify([
          { name: "projects/x/secrets/y/versions/3", state: "ENABLED" },
        ]),
        exitCode: 0,
      };
    }
    throw new Error("unexpected_mock_command");
  }
}

const healthyClient: HealthClient = {
  async getFixedHealth() {
    return { statusCode: 200, tlsValid: true };
  },
};

test("VM status uses only the allowlisted VM, zone, and project", async () => {
  const runner = new MockRunner();
  const ops = new PhishtopiaOps(runner, healthyClient);
  const result = await ops.getVmStatus();
  assert.equal(ToolOutputSchema.safeParse(result).success, true);
  assert.equal(result.status, "ok");
  assert.deepEqual(runner.calls[0]?.args.slice(0, 4), [
    "compute",
    "instances",
    "describe",
    VM_NAME,
  ]);
  assert.ok(runner.calls[0]?.args.includes(`--project=${PROJECT_ID}`));
  assert.ok(runner.calls[0]?.args.includes(`--zone=${ZONE}`));
  assert.equal(runner.calls[0]?.args.includes("--format=json"), true);
});

test("recent errors use a fixed bounded query and never return raw payloads", async () => {
  const runner = new MockRunner();
  const ops = new PhishtopiaOps(runner, healthyClient);
  const result = await ops.getRecentSanitizedErrors();
  const call = runner.calls[0]?.args ?? [];
  assert.ok(call.includes(`--limit=${MAX_LOG_ENTRIES}`));
  assert.ok(call.includes("--freshness=6h"));
  assert.equal(
    result.observations.find((item) => item.name === "bounded_entry_count")
      ?.value,
    String(MAX_LOG_ENTRIES),
  );
  assert.doesNotMatch(
    JSON.stringify(result),
    /private-user|10\.0\.0\.1|authentication failed/i,
  );
  assert.equal(ToolOutputSchema.safeParse(result).success, true);
});

test("backup status needs only bounded object metadata access", async () => {
  const runner = new MockRunner();
  const ops = new PhishtopiaOps(runner, healthyClient);
  const result = await ops.getBackupStatus();
  const call = runner.calls[0]?.args ?? [];
  assert.equal(result.status, "ok");
  assert.deepEqual(call.slice(0, 3), ["storage", "objects", "list"]);
  assert.ok(call.includes("--limit=100"));
  assert.equal(call.includes("buckets"), false);
  assert.equal(ToolOutputSchema.safeParse(result).success, true);
});

test("secret metadata uses versions list rather than payload access", async () => {
  const runner = new MockRunner();
  const ops = new PhishtopiaOps(runner, healthyClient);
  const result = await ops.getSecretMetadata("phishtopia-database-url");
  assert.equal(ToolOutputSchema.safeParse(result).success, true);
  assert.equal(runner.calls.length, 2);
  for (const call of runner.calls) {
    assert.equal(call.args.join(" ").includes(" access "), false);
    assert.ok(call.args.includes(`--project=${PROJECT_ID}`));
  }
  await assert.rejects(
    async () => await ops.getSecretMetadata("unexpected" as never),
  );
});
