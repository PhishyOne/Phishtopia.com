import assert from "node:assert/strict";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import type { CommandRunner } from "../command.js";
import { READ_ONLY_ANNOTATIONS, TOOL_NAMES } from "../constants.js";
import { PhishtopiaOps, type HealthClient } from "../google.js";
import type { ReleaseStatusClient } from "../release-status-client.js";
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
const commit = "a".repeat(40);
const releaseStatus: ReleaseStatusClient = {
  async getReleaseStatus() {
    return {
      status: "ok",
      checkedAt: "2026-08-13T20:20:00.000Z",
      resource: "application_release",
      observations: [
        { name: "deployed_commit", value: commit },
        { name: "last_logged_commit", value: commit },
        { name: "commit_matches_log", value: "true" },
      ],
    };
  },
};
const server = createServer(
  new PhishtopiaOps(runner, health),
  undefined,
  releaseStatus,
);
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
    assert.equal(
      tool.annotations?.readOnlyHint,
      READ_ONLY_ANNOTATIONS.readOnlyHint,
    );
    assert.equal(
      tool.annotations?.destructiveHint,
      READ_ONLY_ANNOTATIONS.destructiveHint,
    );
    assert.equal(
      tool.annotations?.openWorldHint,
      READ_ONLY_ANNOTATIONS.openWorldHint,
    );
  }
  const health = await client.callTool({
    name: "get_public_health",
    arguments: {},
  });
  assert.equal(health.isError, undefined);
  const release = await client.callTool({
    name: "get_release_status",
    arguments: {},
  });
  assert.equal(release.isError, undefined);
  const releaseContent = release.structuredContent as
    { observations?: Array<{ value: string }> } | undefined;
  assert.equal(releaseContent?.observations?.[0]?.value, commit);
  process.stdout.write("protocol_smoke=passed\n");
} finally {
  await client.close();
  await server.close();
}
