import { request } from "node:https";
import { TLSSocket } from "node:tls";

import type { CommandRunner } from "./command.js";
import {
  ALLOWED_SECRETS,
  BACKUP_BUCKET,
  BUILD_ID,
  LOG_FRESHNESS,
  MAX_LOG_ENTRIES,
  PROJECT_ID,
  PUBLIC_HEALTH_URL,
  REGION,
  SERVICE_NAME,
  VM_NAME,
  ZONE,
} from "./constants.js";
import type { Observation, ToolOutput } from "./schema.js";
import { classifyLog, output, safeEnum, safeTimestamp } from "./sanitize.js";

type JsonObject = Record<string, unknown>;

export interface HealthClient {
  getFixedHealth(): Promise<{ statusCode: number; tlsValid: boolean }>;
}

export class FixedHealthClient implements HealthClient {
  async getFixedHealth(): Promise<{ statusCode: number; tlsValid: boolean }> {
    return await new Promise((resolve, reject) => {
      const requestHandle = request(
        PUBLIC_HEALTH_URL,
        { method: "GET", timeout: 10_000, headers: { accept: "text/plain" } },
        (response) => {
          response.resume();
          const socket = response.socket;
          resolve({
            statusCode: response.statusCode ?? 0,
            tlsValid: socket instanceof TLSSocket && socket.authorized === true,
          });
        },
      );
      requestHandle.once("timeout", () =>
        requestHandle.destroy(new Error("timeout")),
      );
      requestHandle.once("error", () =>
        reject(new Error("health_unavailable")),
      );
      requestHandle.end();
    });
  }
}

export function assertReadOnlyGcloudArgs(args: readonly string[]): void {
  const joined = args.join(" ").toLowerCase();
  const forbidden = [
    /(^|\s)secrets\s+versions\s+access(\s|$)/,
    /(^|\s)(update|create|delete|deploy)(\s|$)/,
    /(^|\s)(set-iam-policy|add-iam-policy-binding|remove-iam-policy-binding|update-traffic|ssh)(\s|$)/,
  ];
  if (
    !args.includes(`--project=${PROJECT_ID}`) ||
    forbidden.some((pattern) => pattern.test(joined))
  ) {
    throw new Error("forbidden_or_unscoped_command");
  }
}

function asObject(value: unknown): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown, fallback = "unknown"): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function field(object: JsonObject, ...names: string[]): unknown {
  for (const name of names) {
    if (Object.hasOwn(object, name)) return object[name];
  }
  return undefined;
}

function count(value: unknown): string {
  return String(asArray(value).length);
}

function baseName(value: unknown): string {
  const candidate = text(value);
  const finalSegment = candidate.split("/").at(-1) ?? "unknown";
  return /^[a-z0-9-]+$/i.test(finalSegment) ? finalSegment : "unknown";
}

function conditionStatus(conditions: unknown, type: string): string {
  const condition = asArray(conditions)
    .map(asObject)
    .find((item) => item.type === type);
  return safeEnum(condition?.status, ["True", "False", "Unknown"]);
}

function bytes(value: unknown): string {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) && numeric >= 0
    ? String(Math.floor(numeric))
    : "unknown";
}

export class PhishtopiaOps {
  public constructor(
    private readonly runner: CommandRunner,
    private readonly health: HealthClient,
  ) {}

  private async json(args: string[]): Promise<unknown> {
    assertReadOnlyGcloudArgs(args);
    const result = await this.runner.run("gcloud", args, 20_000);
    try {
      return JSON.parse(result.stdout);
    } catch {
      throw new Error("invalid_google_response");
    }
  }

  async getPublicHealth(): Promise<ToolOutput> {
    const result = await this.health.getFixedHealth();
    const status =
      result.statusCode === 200 && result.tlsValid ? "ok" : "degraded";
    return output("public_health", status, [
      { name: "http_status", value: String(result.statusCode) },
      { name: "tls_validation", value: result.tlsValid ? "passed" : "failed" },
    ]);
  }

  async getVmStatus(): Promise<ToolOutput> {
    const instance = asObject(
      await this.json([
        "compute",
        "instances",
        "describe",
        VM_NAME,
        `--project=${PROJECT_ID}`,
        `--zone=${ZONE}`,
        "--format=json",
      ]),
    );
    const status = safeEnum(instance.status, [
      "RUNNING",
      "STOPPED",
      "TERMINATED",
    ]);
    return output("vm", status === "RUNNING" ? "ok" : "degraded", [
      { name: "instance_state", value: status },
      { name: "machine_type", value: baseName(instance.machineType) },
      {
        name: "service_account_attached",
        value: asArray(instance.serviceAccounts).length > 0 ? "true" : "false",
      },
      {
        name: "deletion_protection",
        value: instance.deletionProtection === true ? "true" : "false",
      },
    ]);
  }

  async getBackupStatus(): Promise<ToolOutput> {
    const objects = asArray(
      await this.json([
        "storage",
        "objects",
        "list",
        `gs://${BACKUP_BUCKET}/postgres/automated/**`,
        `--project=${PROJECT_ID}`,
        "--limit=100",
        "--format=json",
      ]),
    ).map(asObject);
    const latest = [...objects].sort((a, b) =>
      text(field(b, "updateTime", "update_time")).localeCompare(
        text(field(a, "updateTime", "update_time")),
      ),
    )[0];
    const latestHasChecksum = Boolean(
      latest && field(latest, "crc32c", "crc32c_hash", "md5Hash", "md5_hash"),
    );
    const status = objects.length > 0 && latestHasChecksum ? "ok" : "degraded";
    return output("backup_bucket", status, [
      { name: "automated_object_count", value: String(objects.length) },
      {
        name: "latest_object_time",
        value: safeTimestamp(
          latest && field(latest, "updateTime", "update_time"),
        ),
      },
      {
        name: "latest_object_size_bytes",
        value: bytes(latest && field(latest, "size")),
      },
      {
        name: "latest_checksum_present",
        value: latestHasChecksum ? "true" : "false",
      },
    ]);
  }

  async getMonitoringStatus(): Promise<ToolOutput> {
    const [uptimeValue, policyValue, metricValue] = await Promise.all([
      this.json([
        "monitoring",
        "uptime",
        "list-configs",
        `--project=${PROJECT_ID}`,
        "--format=json",
      ]),
      this.json([
        "monitoring",
        "policies",
        "list",
        `--project=${PROJECT_ID}`,
        "--format=json",
      ]),
      this.json([
        "logging",
        "metrics",
        "list",
        `--project=${PROJECT_ID}`,
        "--format=json",
      ]),
    ]);
    const uptime = asArray(uptimeValue);
    const policies = asArray(policyValue).map(asObject);
    const metrics = asArray(metricValue).map(asObject);
    const expectedPolicies = new Set([
      "Phishtopia public HTTPS outage",
      "Phishtopia PostgreSQL backup failure",
      "Phishtopia PostgreSQL backup missing for 30 hours",
    ]);
    const expectedMetrics = new Set([
      "phishtopia_backup_success",
      "phishtopia_backup_failure",
      "phishtopia_backup_missing_30h",
    ]);
    const enabledPolicies = policies.filter(
      (policy) =>
        policy.enabled === true &&
        expectedPolicies.has(text(policy.displayName)),
    ).length;
    const foundMetrics = metrics.filter((metric) =>
      expectedMetrics.has(text(metric.name)),
    ).length;
    const status =
      enabledPolicies === 3 && foundMetrics === 3 && uptime.length >= 1
        ? "ok"
        : "degraded";
    return output("monitoring", status, [
      { name: "uptime_check_count", value: String(uptime.length) },
      {
        name: "expected_alert_policies_enabled",
        value: `${enabledPolicies}/3`,
      },
      { name: "expected_backup_metrics_present", value: `${foundMetrics}/3` },
    ]);
  }

  async getCloudRunStatus(): Promise<ToolOutput> {
    const service = asObject(
      await this.json([
        "run",
        "services",
        "describe",
        SERVICE_NAME,
        `--project=${PROJECT_ID}`,
        `--region=${REGION}`,
        "--format=json",
      ]),
    );
    const statusValue = asObject(service.status);
    const traffic = asArray(statusValue.traffic).map(asObject);
    const trafficSummary = traffic
      .map((entry) => `${baseName(entry.revisionName)}:${bytes(entry.percent)}`)
      .join(",")
      .slice(0, 160);
    const ready = conditionStatus(statusValue.conditions, "Ready");
    return output("cloud_run", ready === "True" ? "ok" : "degraded", [
      { name: "ready_condition", value: ready },
      {
        name: "latest_ready_revision",
        value: baseName(statusValue.latestReadyRevisionName),
      },
      { name: "traffic_percent_by_revision", value: trafficSummary || "none" },
      {
        name: "traffic_tag_count",
        value: String(
          traffic.filter((entry) => typeof entry.tag === "string").length,
        ),
      },
    ]);
  }

  async getRecentSanitizedErrors(): Promise<ToolOutput> {
    const filter = [
      'resource.type="cloud_run_revision"',
      `resource.labels.service_name="${SERVICE_NAME}"`,
      "severity>=ERROR",
    ].join(" AND ");
    const entries = asArray(
      await this.json([
        "logging",
        "read",
        filter,
        `--project=${PROJECT_ID}`,
        `--limit=${MAX_LOG_ENTRIES}`,
        `--freshness=${LOG_FRESHNESS}`,
        "--order=desc",
        "--format=json",
      ]),
    )
      .slice(0, MAX_LOG_ENTRIES)
      .map(asObject);
    const classifications = new Map<string, number>();
    for (const entry of entries) {
      const payload =
        entry.textPayload ?? entry.jsonPayload ?? entry.protoPayload ?? "";
      const category = classifyLog(
        typeof payload === "string" ? payload : JSON.stringify(payload),
      );
      classifications.set(category, (classifications.get(category) ?? 0) + 1);
    }
    const observations: Observation[] = [
      { name: "query_window", value: LOG_FRESHNESS },
      { name: "bounded_entry_count", value: String(entries.length) },
    ];
    for (const [category, total] of [...classifications.entries()]
      .sort()
      .slice(0, 6)) {
      observations.push({ name: `count_${category}`, value: String(total) });
    }
    return output(
      "sanitized_errors",
      entries.length === 0 ? "ok" : "degraded",
      observations,
    );
  }

  async getBuildStatus(): Promise<ToolOutput> {
    const build = asObject(
      await this.json([
        "builds",
        "describe",
        BUILD_ID,
        `--project=${PROJECT_ID}`,
        "--format=json",
      ]),
    );
    const status = safeEnum(build.status, [
      "SUCCESS",
      "FAILURE",
      "QUEUED",
      "WORKING",
      "CANCELLED",
      "TIMEOUT",
    ]);
    return output("cloud_build", status === "SUCCESS" ? "ok" : "degraded", [
      { name: "build_status", value: status },
      { name: "create_time", value: safeTimestamp(build.createTime) },
      { name: "finish_time", value: safeTimestamp(build.finishTime) },
    ]);
  }

  async getSecretMetadata(
    secret: "phishtopia-session-secret" | "phishtopia-database-url",
  ): Promise<ToolOutput> {
    if (!(ALLOWED_SECRETS as readonly string[]).includes(secret)) {
      throw new Error("secret_not_allowlisted");
    }
    const [secretValue, versionsValue] = await Promise.all([
      this.json([
        "secrets",
        "describe",
        secret,
        `--project=${PROJECT_ID}`,
        "--format=json",
      ]),
      this.json([
        "secrets",
        "versions",
        "list",
        secret,
        `--project=${PROJECT_ID}`,
        "--limit=10",
        "--format=json",
      ]),
    ]);
    const metadata = asObject(secretValue);
    const versions = asArray(versionsValue).map(asObject);
    const enabled = versions.filter(
      (version) => version.state === "ENABLED",
    ).length;
    return output("secret_metadata", "ok", [
      { name: "secret", value: secret },
      { name: "secret_created", value: safeTimestamp(metadata.createTime) },
      { name: "listed_version_count", value: String(versions.length) },
      { name: "enabled_version_count", value: String(enabled) },
      { name: "latest_listed_version", value: baseName(versions[0]?.name) },
    ]);
  }

  async getProductionSummary(): Promise<ToolOutput> {
    const checks = await Promise.allSettled([
      this.getPublicHealth(),
      this.getVmStatus(),
      this.getBackupStatus(),
      this.getMonitoringStatus(),
      this.getCloudRunStatus(),
    ]);
    const observations: Observation[] = checks.map((check, index) => {
      const name =
        ["public_health", "vm", "backup", "monitoring", "cloud_run"][index] ??
        "unknown";
      return {
        name,
        value:
          check.status === "fulfilled" ? check.value.status : "unavailable",
      };
    });
    const allOk = checks.every(
      (check) => check.status === "fulfilled" && check.value.status === "ok",
    );
    return output(
      "production_summary",
      allOk ? "ok" : "degraded",
      observations,
    );
  }
}
