import { request } from "node:https";

import type { CommandRunner } from "./command.js";
import {
  CLOUDFLARE_DNS_SECRET,
  CLOUDFLARE_ROOT_A,
  CLOUDFLARE_WWW_CNAME,
  CLOUDFLARE_ZONE,
  PROJECT_ID,
} from "./constants.js";
import type { ToolOutput } from "./schema.js";

type JsonObject = Record<string, unknown>;

export type CloudflareJsonRequester = (
  path: string,
  token: string,
) => Promise<unknown>;

export interface CloudflareDnsStatusClient {
  getStatus(): Promise<ToolOutput>;
}

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{30,200}$/;
const ZONE_ID_PATTERN = /^[0-9a-f]{32}$/;
const RECORD_ID_PATTERN = /^[0-9a-f]{32}$/;
const VERIFY_PATH = "user/tokens/verify";
const ZONE_PATH = "zones?name=phishtopia.com&status=active&per_page=2";

function asObject(value: unknown): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function cloudflareResult(value: unknown): unknown {
  const envelope = asObject(value);
  if (envelope.success !== true) throw new Error("cloudflare_request_failed");
  return envelope.result;
}

function recordPath(zoneId: string, name: string, type: "A" | "CNAME"): string {
  if (!ZONE_ID_PATTERN.test(zoneId)) throw new Error("cloudflare_zone_invalid");
  const expectedName =
    type === "A" ? CLOUDFLARE_ZONE : `www.${CLOUDFLARE_ZONE}`;
  if (name !== expectedName)
    throw new Error("cloudflare_record_not_allowlisted");
  return `zones/${zoneId}/dns_records?name=${encodeURIComponent(name)}&type=${type}&per_page=2`;
}

export function assertFixedCloudflarePath(path: string): void {
  if (path === VERIFY_PATH || path === ZONE_PATH) return;
  if (
    /^zones\/[0-9a-f]{32}\/dns_records\?name=phishtopia\.com&type=A&per_page=2$/.test(
      path,
    ) ||
    /^zones\/[0-9a-f]{32}\/dns_records\?name=www\.phishtopia\.com&type=CNAME&per_page=2$/.test(
      path,
    )
  ) {
    return;
  }
  throw new Error("cloudflare_path_not_allowlisted");
}

export function assertFixedSecretAccessArgs(args: readonly string[]): void {
  const expected = [
    "secrets",
    "versions",
    "access",
    "latest",
    `--secret=${CLOUDFLARE_DNS_SECRET}`,
    `--project=${PROJECT_ID}`,
  ];
  if (
    args.length !== expected.length ||
    args.some((value, index) => value !== expected[index])
  ) {
    throw new Error("secret_access_not_allowlisted");
  }
}

export async function fixedCloudflareRequest(
  path: string,
  token: string,
): Promise<unknown> {
  assertFixedCloudflarePath(path);
  if (!TOKEN_PATTERN.test(token)) throw new Error("cloudflare_token_invalid");

  return await new Promise((resolve, reject) => {
    const handle = request(
      {
        hostname: "api.cloudflare.com",
        port: 443,
        path: `/client/v4/${path}`,
        method: "GET",
        timeout: 10_000,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${token}`,
          "user-agent": "phishtopia-ops-mcp/0.3",
        },
      },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error("cloudflare_http_error"));
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        response.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > 65_536) {
            response.destroy(new Error("cloudflare_response_too_large"));
            return;
          }
          chunks.push(chunk);
        });
        response.once("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch {
            reject(new Error("cloudflare_response_invalid"));
          }
        });
        response.once("error", () =>
          reject(new Error("cloudflare_response_unavailable")),
        );
      },
    );
    handle.once("timeout", () =>
      handle.destroy(
        Object.assign(new Error("timeout"), { name: "AbortError" }),
      ),
    );
    handle.once("error", (error) => reject(error));
    handle.end();
  });
}

type FixedRecord = {
  name: string;
  type: "A" | "CNAME";
  target: string;
  proxied: boolean;
};

function parseRecord(
  value: unknown,
  expectedName: string,
  expectedType: "A" | "CNAME",
): FixedRecord {
  const records = asArray(cloudflareResult(value)).map(asObject);
  if (records.length !== 1) throw new Error("cloudflare_record_not_unique");
  const record = records[0]!;
  if (
    !RECORD_ID_PATTERN.test(String(record.id ?? "")) ||
    record.name !== expectedName ||
    record.type !== expectedType ||
    typeof record.content !== "string" ||
    typeof record.proxied !== "boolean"
  ) {
    throw new Error("cloudflare_record_invalid");
  }

  const normalized = record.content.replace(/\.$/, "").toLowerCase();
  if (expectedType === "A") {
    const octets = normalized.split(".");
    if (
      octets.length !== 4 ||
      octets.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)
    ) {
      throw new Error("cloudflare_record_target_invalid");
    }
  } else if (!/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/.test(normalized)) {
    throw new Error("cloudflare_record_target_invalid");
  }

  return {
    name: expectedName,
    type: expectedType,
    target: normalized,
    proxied: record.proxied,
  };
}

export class FixedCloudflareDnsStatusClient implements CloudflareDnsStatusClient {
  public constructor(
    private readonly runner: CommandRunner,
    private readonly requester: CloudflareJsonRequester = fixedCloudflareRequest,
  ) {}

  private async token(): Promise<string> {
    const args = [
      "secrets",
      "versions",
      "access",
      "latest",
      `--secret=${CLOUDFLARE_DNS_SECRET}`,
      `--project=${PROJECT_ID}`,
    ] as const;
    assertFixedSecretAccessArgs(args);
    const result = await this.runner.run("gcloud", args, 20_000);
    const token = result.stdout.trim();
    if (!TOKEN_PATTERN.test(token)) throw new Error("cloudflare_token_invalid");
    return token;
  }

  async getStatus(): Promise<ToolOutput> {
    let token = await this.token();
    try {
      const verification = asObject(
        cloudflareResult(await this.requester(VERIFY_PATH, token)),
      );
      if (verification.status !== "active") {
        throw new Error("cloudflare_token_inactive");
      }

      const zones = asArray(
        cloudflareResult(await this.requester(ZONE_PATH, token)),
      ).map(asObject);
      if (
        zones.length !== 1 ||
        zones[0]?.name !== CLOUDFLARE_ZONE ||
        zones[0]?.status !== "active" ||
        !ZONE_ID_PATTERN.test(String(zones[0]?.id ?? ""))
      ) {
        throw new Error("cloudflare_zone_not_visible");
      }
      const zoneId = String(zones[0]!.id);

      const [root, www] = await Promise.all([
        this.requester(recordPath(zoneId, CLOUDFLARE_ZONE, "A"), token),
        this.requester(
          recordPath(zoneId, `www.${CLOUDFLARE_ZONE}`, "CNAME"),
          token,
        ),
      ]);
      const rootRecord = parseRecord(root, CLOUDFLARE_ZONE, "A");
      const wwwRecord = parseRecord(www, `www.${CLOUDFLARE_ZONE}`, "CNAME");
      const expected =
        rootRecord.target === CLOUDFLARE_ROOT_A &&
        rootRecord.proxied === false &&
        wwwRecord.target === CLOUDFLARE_WWW_CNAME &&
        wwwRecord.proxied === false;

      return {
        status: expected ? "ok" : "degraded",
        checkedAt: new Date().toISOString(),
        resource: "cloudflare_dns",
        observations: [
          { name: "token_status", value: "active" },
          { name: "zone_visibility", value: "passed" },
          { name: "dns_read_permission", value: "passed" },
          { name: "root_record_name", value: rootRecord.name },
          { name: "root_record_type", value: rootRecord.type },
          { name: "root_record_target", value: rootRecord.target },
          { name: "root_record_proxied", value: String(rootRecord.proxied) },
          { name: "www_record_name", value: wwwRecord.name },
          { name: "www_record_type", value: wwwRecord.type },
          { name: "www_record_target", value: wwwRecord.target },
          { name: "www_record_proxied", value: String(wwwRecord.proxied) },
          { name: "records_match_expected", value: String(expected) },
        ],
      };
    } finally {
      token = "";
    }
  }
}
