import assert from "node:assert/strict";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import type { CommandRunner } from "../command.js";
import {
  MUTATING_JOB_ANNOTATIONS,
  READ_ONLY_ANNOTATIONS,
  TOOL_NAMES,
} from "../constants.js";
import { PhishtopiaOps, type HealthClient } from "../google.js";
import { createServer } from "../server.js";

const client = new Client({
  name: "phishtopia-ops-mcp-smoke",
  version: "0.1.0",
});
const runner: CommandRunner = {
  async run() {
    throw new Error("unexpected_protocol_smoke_command");
  },
};
const health: HealthClient = {
  async getFixedHealth() {
    return { statusCode: 200, tlsValid: true };
  },
};
const server = createServer(new PhishtopiaOps(runner, health));
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

try {
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  const listed = await client.listTools();
  assert.deepEqual(
    listed.tools.map((tool) => tool.name).sort(),
    [...TOOL_NAMES].sort(),
  );
  for (const tool of listed.tools) {
    const expected =
      tool.name === "start_job" || tool.name === "cancel_job"
        ? MUTATING_JOB_ANNOTATIONS
        : READ_ONLY_ANNOTATIONS;
    assert.equal(tool.annotations?.readOnlyHint, expected.readOnlyHint);
    assert.equal(tool.annotations?.destructiveHint, expected.destructiveHint);
    assert.equal(tool.annotations?.openWorldHint, expected.openWorldHint);
  }
  const health = await client.callTool({
    name: "get_public_health",
    arguments: {},
  });
  assert.equal(health.isError, undefined);
  process.stdout.write("protocol_smoke=passed\n");
} finally {
  await client.close();
  await server.close();
}
