import assert from "node:assert/strict";
import test from "node:test";

import { READ_ONLY_ANNOTATIONS, TOOL_NAMES } from "../constants.js";
import { TOOL_DEFINITIONS } from "../server.js";

test("the exported ChatGPT tool surface is exact and read-only", () => {
  assert.deepEqual(
    Object.keys(TOOL_DEFINITIONS).sort(),
    [...TOOL_NAMES].sort(),
  );
  assert.deepEqual(READ_ONLY_ANNOTATIONS, {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  });
  assert.equal(TOOL_NAMES.length, 11);
  assert.equal(
    TOOL_NAMES.filter((name) => name === "get_cloudflare_dns_status").length,
    1,
  );
  for (const prohibited of ["start_job", "get_job_status", "cancel_job"]) {
    assert.equal(TOOL_NAMES.includes(prohibited as never), false);
  }
  const prohibited =
    /shell|gcloud.command|sql|http.proxy|file.read|secret.access|deploy|traffic|iam|restart|database.write/i;
  for (const toolName of TOOL_NAMES)
    assert.equal(prohibited.test(toolName), false);
});
