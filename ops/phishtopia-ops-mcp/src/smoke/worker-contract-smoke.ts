import assert from "node:assert/strict";
import { createConnection } from "node:net";

import { ACTION_NAMES, JOB_SOCKET } from "../constants.js";

const request = async (operation: string): Promise<string> =>
  new Promise<string>((resolve, reject) => {
    const socket = createConnection({ path: JOB_SOCKET });
    let value = "";
    const timeout = setTimeout(
      () => socket.destroy(new Error("worker_contract_timeout")),
      15_000,
    );
    socket.setEncoding("utf8");
    socket.once("connect", () =>
      socket.end(`${JSON.stringify({ operation, payload: {} })}\n`),
    );
    socket.on("data", (chunk: string) => {
      value += chunk;
      if (value.length > 65_536)
        socket.destroy(new Error("worker_contract_too_large"));
    });
    socket.once("error", reject);
    socket.once("end", () => {
      clearTimeout(timeout);
      resolve(value);
    });
  });

const response = await request("get_contract");

const parsed = JSON.parse(response) as {
  ok?: unknown;
  contract?: { version?: unknown; actions?: unknown; singleFlight?: unknown };
};
assert.equal(parsed.ok, true);
assert.equal(parsed.contract?.version, "issue15-v1");
assert.equal(parsed.contract?.singleFlight, "production_mutation");
assert.deepEqual(parsed.contract?.actions, [...ACTION_NAMES].sort());
const preflight = JSON.parse(await request("get_runtime_preflight")) as {
  ok?: unknown;
  preflight?: {
    pm2?: unknown;
    postgres?: unknown;
    mcpUser?: unknown;
    gcloudIdentity?: unknown;
    dnsRollback?: unknown;
  };
};
assert.equal(preflight.ok, true);
assert.deepEqual(preflight.preflight, {
  pm2: "passed",
  postgres: "passed",
  mcpUser: "passed",
  gcloudIdentity: "passed",
  dnsRollback: "passed",
});
process.stdout.write("worker_contract_smoke=passed\n");
