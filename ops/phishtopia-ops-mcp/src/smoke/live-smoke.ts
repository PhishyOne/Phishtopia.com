import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { ToolOutputSchema } from "../schema.js";

const serverPath = fileURLToPath(new URL("../index.js", import.meta.url));
const client = new Client({
  name: "phishtopia-ops-mcp-live-smoke",
  version: "0.1.0",
});
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  cwd: process.cwd(),
  stderr: "ignore",
});

const calls = [
  ["get_production_summary", {}],
  ["get_public_health", {}],
  ["get_vm_status", {}],
  ["get_backup_status", {}],
  ["get_monitoring_status", {}],
  ["get_cloud_run_status", {}],
  ["get_recent_sanitized_errors", {}],
  ["get_build_status", {}],
  ["get_secret_metadata", { secret: "phishtopia-database-url" }],
  ["get_cloudflare_dns_status", {}],
] as const;

try {
  await client.connect(transport);
  for (const [name, argumentsValue] of calls) {
    const response = await client.callTool({ name, arguments: argumentsValue });
    assert.equal(
      response.isError,
      undefined,
      `${name} returned a sanitized error`,
    );
    const parsed = ToolOutputSchema.parse(response.structuredContent);
    process.stdout.write(
      `${name}: status=${parsed.status} fields=${parsed.observations.map((item) => item.name).join(",")}\n`,
    );
  }
  process.stdout.write("live_smoke=passed\n");
} finally {
  await client.close();
}
