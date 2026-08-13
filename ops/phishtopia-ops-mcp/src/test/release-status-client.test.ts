import assert from "node:assert/strict";
import test from "node:test";

import { UnixReleaseStatusClient } from "../release-status-client.js";

const commit = "a".repeat(40);

test("release status client sends one fixed no-input request and validates output", async () => {
  let request = "";
  const client = new UnixReleaseStatusClient(
    "/run/phishtopia-ops-worker/worker.sock",
    async (_socketPath, encoded) => {
      request = encoded;
      return `${JSON.stringify({
        ok: true,
        releaseStatus: {
          status: "ok",
          checkedAt: "2026-08-13T20:20:00.000Z",
          resource: "application_release",
          observations: [
            { name: "deployed_commit", value: commit },
            { name: "last_logged_commit", value: commit },
            { name: "commit_matches_log", value: "true" },
          ],
        },
      })}\n`;
    },
  );

  const result = await client.getReleaseStatus();
  assert.deepEqual(JSON.parse(request), {
    operation: "get_release_status",
    payload: {},
  });
  assert.equal(result.status, "ok");
  assert.equal(result.observations[0]?.value, commit);
});

test("release status client rejects malformed worker output", async () => {
  const client = new UnixReleaseStatusClient(
    "/run/phishtopia-ops-worker/worker.sock",
    async () =>
      `${JSON.stringify({
        ok: true,
        releaseStatus: {
          status: "ok",
          checkedAt: "not-a-time",
          resource: "application_release",
          observations: [{ name: "raw_log", value: "secret output" }],
        },
      })}\n`,
  );
  await assert.rejects(
    async () => await client.getReleaseStatus(),
    /invalid_worker_response/,
  );
});
