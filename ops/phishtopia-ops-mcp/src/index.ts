import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { ProcessRunner } from "./command.js";
import { FixedHealthClient, PhishtopiaOps } from "./google.js";
import { UnixJobClient } from "./job-client.js";
import { createServer } from "./server.js";

const server = createServer(
  new PhishtopiaOps(new ProcessRunner(), new FixedHealthClient()),
  new UnixJobClient(),
);

server.connect(new StdioServerTransport()).catch(() => {
  process.stderr.write("phishtopia-ops-mcp failed to start\n");
  process.exitCode = 1;
});
