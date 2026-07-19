import assert from "node:assert/strict";
import test from "node:test";

import { WORKER_REQUEST_TIMEOUT_MS } from "../smoke/worker-contract-policy.js";

test("worker contract smoke keeps socket readiness short and bounds runtime preflight", () => {
  assert.equal(WORKER_REQUEST_TIMEOUT_MS.get_contract, 15_000);
  assert.equal(WORKER_REQUEST_TIMEOUT_MS.get_runtime_preflight, 120_000);
  assert.ok(
    WORKER_REQUEST_TIMEOUT_MS.get_runtime_preflight >
      WORKER_REQUEST_TIMEOUT_MS.get_contract,
  );
  assert.ok(Object.isFrozen(WORKER_REQUEST_TIMEOUT_MS));
});
