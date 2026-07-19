import assert from "node:assert/strict";
import test from "node:test";

import { UnixJobClient } from "../job-client.js";

const commit = "a".repeat(40);
const jobId = "123e4567-e89b-42d3-a456-426614174000";

test("Unix job client uses one bounded JSON request and validates the worker response", async () => {
  let request = "";
  const client = new UnixJobClient(
    "/run/phishtopia-ops-worker/worker.sock",
    async (_socketPath, encoded) => {
      request = encoded;
      return `${JSON.stringify({
        ok: true,
        job: {
          jobId,
          action: "upgrade_ops_release",
          state: "queued",
          progress: 0,
          createdAt: "2026-07-18T00:00:00.000Z",
          updatedAt: "2026-07-18T00:00:00.000Z",
          deadlineAt: "2026-07-18T00:20:00.000Z",
          resultCode: "accepted",
          observations: [],
        },
      })}\n`;
    },
  );
  const result = await client.start({
    idempotencyKey: "release-0001",
    action: {
      type: "upgrade_ops_release",
      commit,
      artifactSha256: "b".repeat(64),
    },
  });
  assert.equal(
    (JSON.parse(request) as { operation: string }).operation,
    "start_job",
  );
  assert.equal(result.jobId, jobId);
  assert.equal(result.state, "queued");
});
