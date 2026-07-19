import assert from "node:assert/strict";
import test from "node:test";

import {
  MUTATING_JOB_ANNOTATIONS,
  READ_ONLY_ANNOTATIONS,
  TOOL_NAMES,
} from "../constants.js";
import { TOOL_DEFINITIONS } from "../server.js";

test("the exported tool surface is exact, annotated, and excludes generic control tools", () => {
  assert.deepEqual(
    Object.keys(TOOL_DEFINITIONS).sort(),
    [...TOOL_NAMES].sort(),
  );
  assert.deepEqual(READ_ONLY_ANNOTATIONS, {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  });
  assert.deepEqual(MUTATING_JOB_ANNOTATIONS, {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  });
  assert.equal(TOOL_NAMES.length, 13);
  assert.equal(
    TOOL_NAMES.filter((name) => name === "get_cloudflare_dns_status").length,
    1,
  );
  const prohibited =
    /shell|gcloud.command|sql|http.proxy|file.read|secret.access|deploy|traffic|iam|restart|database.write/i;
  for (const toolName of TOOL_NAMES)
    assert.equal(prohibited.test(toolName), false);
});
