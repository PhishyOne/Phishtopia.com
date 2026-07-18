import assert from "node:assert/strict";
import test from "node:test";

test("production logs are outside immutable release source", async () => {
    process.env.NODE_ENV = "production";
    const { logsDir, rootDir } = await import("../src/config/paths.js?production-log-test");
    assert.equal(logsDir, "/var/log/phishtopia");
    assert.equal(logsDir.startsWith(`${rootDir}/`), false);
});
