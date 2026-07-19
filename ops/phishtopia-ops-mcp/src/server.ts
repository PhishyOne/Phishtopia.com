import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { CloudflareDnsStatusClient } from "./cloudflare.js";
import {
  MUTATING_JOB_ANNOTATIONS,
  READ_ONLY_ANNOTATIONS,
  TOOL_NAMES,
} from "./constants.js";
import type { PhishtopiaOps } from "./google.js";
import type { JobClient } from "./job-client.js";
import {
  JobIdInputSchema,
  JobOutputSchema,
  NoArgsSchema,
  SecretMetadataInputSchema,
  StartJobInputSchema,
  ToolOutputSchema,
  type ToolOutput,
} from "./schema.js";
import { safeErrorCode } from "./sanitize.js";

export const TOOL_DEFINITIONS = {
  get_production_summary:
    "Read-only consolidated health and configuration summary for fixed Phishtopia resources.",
  get_public_health:
    "Read-only TLS-validated HTTP 200 check for the fixed public health endpoint.",
  get_vm_status:
    "Read-only Compute Engine instance metadata status for the fixed Phishtopia VM.",
  get_backup_status:
    "Read-only private backup-bucket metadata and latest automated backup verification metadata.",
  get_monitoring_status:
    "Read-only count and expected-state summary for fixed Phishtopia Monitoring resources.",
  get_cloud_run_status:
    "Read-only Cloud Run readiness and traffic summary for the fixed Phishtopia service.",
  get_recent_sanitized_errors:
    "Read-only, fixed six-hour, ten-entry Cloud Run error classification summary; raw logs are never returned.",
  get_build_status:
    "Read-only status metadata for the fixed production Cloud Build.",
  get_secret_metadata:
    "Read-only metadata and version states for one allowlisted secret; payload access is impossible.",
  get_cloudflare_dns_status:
    "Read-only validation of the fixed Cloudflare DNS token, phishtopia.com zone, root A record, and www CNAME; the token is never returned.",
  start_job:
    "Start one durable, deadline-bounded allowlisted Phishtopia operation after a sanitized preview and independent root-worker validation.",
  get_job_status:
    "Read bounded sanitized status metadata for one durable Phishtopia operations job.",
  cancel_job:
    "Request cancellation and automatic rollback for one durable Phishtopia operations job.",
} as const;

function result(value: ToolOutput) {
  return {
    structuredContent: value,
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
  };
}

function unavailable(error: unknown) {
  const code = safeErrorCode(error);
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: JSON.stringify({ error: code }) }],
  };
}

function noArgTool(
  server: McpServer,
  name: keyof typeof TOOL_DEFINITIONS,
  handler: () => Promise<ToolOutput>,
) {
  server.registerTool(
    name,
    {
      title: name.replaceAll("_", " "),
      description: TOOL_DEFINITIONS[name],
      inputSchema: NoArgsSchema,
      outputSchema: ToolOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async () => {
      try {
        return result(await handler());
      } catch (error) {
        return unavailable(error);
      }
    },
  );
}

function jobResult(value: unknown) {
  const parsed = JobOutputSchema.parse(value);
  return {
    structuredContent: parsed,
    content: [{ type: "text" as const, text: JSON.stringify(parsed) }],
  };
}

export function createServer(
  ops: PhishtopiaOps,
  jobs?: JobClient,
  cloudflare?: CloudflareDnsStatusClient,
): McpServer {
  const server = new McpServer(
    { name: "phishtopia-ops-mcp", version: "0.3.0" },
    {
      instructions:
        "Ten observer tools query fixed Phishtopia resources. Three job tools submit only typed allowlisted actions to an independently validating root worker. Outputs are bounded and sanitized; credentials, raw logs, user data, arbitrary commands, paths, URLs, SQL, and HTTP proxying are never exposed. The Cloudflare observer may read only the fixed DNS token and returns only strictly validated zone and record status.",
    },
  );

  noArgTool(server, "get_production_summary", () => ops.getProductionSummary());
  noArgTool(server, "get_public_health", () => ops.getPublicHealth());
  noArgTool(server, "get_vm_status", () => ops.getVmStatus());
  noArgTool(server, "get_backup_status", () => ops.getBackupStatus());
  noArgTool(server, "get_monitoring_status", () => ops.getMonitoringStatus());
  noArgTool(server, "get_cloud_run_status", () => ops.getCloudRunStatus());
  noArgTool(server, "get_recent_sanitized_errors", () =>
    ops.getRecentSanitizedErrors(),
  );
  noArgTool(server, "get_build_status", () => ops.getBuildStatus());
  noArgTool(server, "get_cloudflare_dns_status", async () => {
    if (!cloudflare) throw new Error("cloudflare_observer_unavailable");
    return await cloudflare.getStatus();
  });

  server.registerTool(
    "get_secret_metadata",
    {
      title: "get secret metadata",
      description: TOOL_DEFINITIONS.get_secret_metadata,
      inputSchema: SecretMetadataInputSchema,
      outputSchema: ToolOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ secret }) => {
      try {
        return result(await ops.getSecretMetadata(secret));
      } catch (error) {
        return unavailable(error);
      }
    },
  );

  server.registerTool(
    "start_job",
    {
      title: "start allowlisted operations job",
      description: TOOL_DEFINITIONS.start_job,
      inputSchema: StartJobInputSchema,
      outputSchema: JobOutputSchema,
      annotations: MUTATING_JOB_ANNOTATIONS,
    },
    async (input) => {
      try {
        if (!jobs) throw new Error("worker_unavailable");
        return jobResult(await jobs.start(StartJobInputSchema.parse(input)));
      } catch (error) {
        return unavailable(error);
      }
    },
  );

  server.registerTool(
    "get_job_status",
    {
      title: "get operations job status",
      description: TOOL_DEFINITIONS.get_job_status,
      inputSchema: JobIdInputSchema,
      outputSchema: JobOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ jobId }) => {
      try {
        if (!jobs) throw new Error("worker_unavailable");
        return jobResult(await jobs.status(jobId));
      } catch (error) {
        return unavailable(error);
      }
    },
  );

  server.registerTool(
    "cancel_job",
    {
      title: "cancel operations job",
      description: TOOL_DEFINITIONS.cancel_job,
      inputSchema: JobIdInputSchema,
      outputSchema: JobOutputSchema,
      annotations: MUTATING_JOB_ANNOTATIONS,
    },
    async ({ jobId }) => {
      try {
        if (!jobs) throw new Error("worker_unavailable");
        return jobResult(await jobs.cancel(jobId));
      } catch (error) {
        return unavailable(error);
      }
    },
  );

  if (Object.keys(TOOL_DEFINITIONS).length !== TOOL_NAMES.length) {
    throw new Error("tool_allowlist_mismatch");
  }
  return server;
}
