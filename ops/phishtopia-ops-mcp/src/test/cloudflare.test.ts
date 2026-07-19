import assert from "node:assert/strict";
import test from "node:test";

import {
  assertFixedCloudflarePath,
  assertFixedSecretAccessArgs,
  FixedCloudflareDnsStatusClient,
  type CloudflareJsonRequester,
} from "../cloudflare.js";
import type { CommandRunner } from "../command.js";
import { ToolOutputSchema } from "../schema.js";

const TOKEN =
  "abcdefghijklmnopqrstuvwxyz_ABCDEFGHIJKLMNOPQRSTUVWXYZ-1234567890";
const ZONE_ID = "0123456789abcdef0123456789abcdef";

function successfulRequester(): CloudflareJsonRequester {
  return async (path) => {
    if (path === "user/tokens/verify") {
      return { success: true, result: { status: "active" } };
    }
    if (path === "zones?name=phishtopia.com&status=active&per_page=2") {
      return {
        success: true,
        result: [{ id: ZONE_ID, name: "phishtopia.com", status: "active" }],
      };
    }
    if (
      path ===
      `zones/${ZONE_ID}/dns_records?name=phishtopia.com&type=A&per_page=2`
    ) {
      return {
        success: true,
        result: [
          {
            id: "11111111111111111111111111111111",
            name: "phishtopia.com",
            type: "A",
            content: "34.73.92.179",
            proxied: false,
          },
        ],
      };
    }
    if (
      path ===
      `zones/${ZONE_ID}/dns_records?name=www.phishtopia.com&type=CNAME&per_page=2`
    ) {
      return {
        success: true,
        result: [
          {
            id: "22222222222222222222222222222222",
            name: "www.phishtopia.com",
            type: "CNAME",
            content: "phishtopia-ht3gdpkzmq-ue.a.run.app",
            proxied: false,
          },
        ],
      };
    }
    throw new Error("unexpected_cloudflare_path");
  };
}

function tokenRunner(): CommandRunner {
  return {
    async run(file, args, _timeoutMs) {
      assert.equal(file, "gcloud");
      assertFixedSecretAccessArgs(args);
      return { stdout: `${TOKEN}\n`, exitCode: 0 };
    },
  };
}

test("the Cloudflare observer accepts only the fixed secret access command", () => {
  const exact = [
    "secrets",
    "versions",
    "access",
    "latest",
    "--secret=phishtopia-cloudflare-dns-token",
    "--project=project-43a8be4b-69a7-4d52-805",
  ];
  assert.doesNotThrow(() => assertFixedSecretAccessArgs(exact));
  assert.throws(() =>
    assertFixedSecretAccessArgs(
      exact.map((value) =>
        value.includes("cloudflare") ? "--secret=other-secret" : value,
      ),
    ),
  );
  assert.throws(() =>
    assertFixedSecretAccessArgs([...exact, "--impersonate-service-account=x"]),
  );
});

test("the Cloudflare HTTP client accepts only fixed read paths", () => {
  assert.doesNotThrow(() => assertFixedCloudflarePath("user/tokens/verify"));
  assert.doesNotThrow(() =>
    assertFixedCloudflarePath(
      `zones/${ZONE_ID}/dns_records?name=phishtopia.com&type=A&per_page=2`,
    ),
  );
  assert.throws(() =>
    assertFixedCloudflarePath(`zones/${ZONE_ID}/dns_records`),
  );
  assert.throws(() =>
    assertFixedCloudflarePath(
      `zones/${ZONE_ID}/dns_records?name=evil.example&type=A&per_page=2`,
    ),
  );
});

test("the observer returns fixed DNS status without exposing the token", async () => {
  const client = new FixedCloudflareDnsStatusClient(
    tokenRunner(),
    successfulRequester(),
  );
  const result = ToolOutputSchema.parse(await client.getStatus());

  assert.equal(result.status, "ok");
  assert.equal(result.resource, "cloudflare_dns");
  assert.deepEqual(
    Object.fromEntries(
      result.observations.map((item) => [item.name, item.value]),
    ),
    {
      token_status: "active",
      zone_visibility: "passed",
      dns_read_permission: "passed",
      root_record_name: "phishtopia.com",
      root_record_type: "A",
      root_record_target: "34.73.92.179",
      root_record_proxied: "false",
      www_record_name: "www.phishtopia.com",
      www_record_type: "CNAME",
      www_record_target: "phishtopia-ht3gdpkzmq-ue.a.run.app",
      www_record_proxied: "false",
      records_match_expected: "true",
    },
  );
  assert.doesNotMatch(JSON.stringify(result), new RegExp(TOKEN));
});

test("unexpected record targets are visible but marked degraded", async () => {
  const requester = successfulRequester();
  const client = new FixedCloudflareDnsStatusClient(
    tokenRunner(),
    async (path, token) => {
      const value = await requester(path, token);
      if (path.includes("name=phishtopia.com&type=A")) {
        return {
          success: true,
          result: [
            {
              id: "11111111111111111111111111111111",
              name: "phishtopia.com",
              type: "A",
              content: "203.0.113.10",
              proxied: false,
            },
          ],
        };
      }
      return value;
    },
  );

  const result = await client.getStatus();
  assert.equal(result.status, "degraded");
  assert.equal(
    result.observations.find((item) => item.name === "root_record_target")
      ?.value,
    "203.0.113.10",
  );
  assert.equal(
    result.observations.find((item) => item.name === "records_match_expected")
      ?.value,
    "false",
  );
});

test("inactive tokens and ambiguous zones fail closed", async () => {
  const inactive = new FixedCloudflareDnsStatusClient(
    tokenRunner(),
    async (path) => {
      if (path === "user/tokens/verify") {
        return { success: true, result: { status: "disabled" } };
      }
      throw new Error("unexpected_request");
    },
  );
  await assert.rejects(inactive.getStatus());

  const ambiguous = new FixedCloudflareDnsStatusClient(
    tokenRunner(),
    async (path) => {
      if (path === "user/tokens/verify") {
        return { success: true, result: { status: "active" } };
      }
      if (path === "zones?name=phishtopia.com&status=active&per_page=2") {
        return {
          success: true,
          result: [
            { id: ZONE_ID, name: "phishtopia.com", status: "active" },
            { id: "f".repeat(32), name: "phishtopia.com", status: "active" },
          ],
        };
      }
      throw new Error("unexpected_request");
    },
  );
  await assert.rejects(ambiguous.getStatus());
});
