import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { FixedCloudflareDnsStatusClient } from "./cloudflare.js";
import { ProcessRunner } from "./command.js";
import { FixedHealthClient, PhishtopiaOps } from "./google.js";
import { UnixReleaseStatusClient } from "./release-status-client.js";
import { createServer } from "./server.js";

const runner = new ProcessRunner();
const server = createServer(
  new PhishtopiaOps(runner, new FixedHealthClient()),
  new FixedCloudflareDnsStatusClient(runner),
  new UnixReleaseStatusClient(),
);

server.connect(new StdioServerTransport()).catch(() => {
  process.stderr.write("phishtopia-ops-mcp failed to start\n");
  process.exitCode = 1;
});
