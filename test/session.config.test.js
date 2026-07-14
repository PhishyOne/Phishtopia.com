import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
    buildCookieConfig,
    resolveSessionSecret
} from "../src/config/session.js";

const originalSecret = process.env.SESSION_SECRET;

afterEach(() => {
    if (originalSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = originalSecret;
});

test("production cookies remain secure and same-site", () => {
    assert.deepEqual(buildCookieConfig(true), {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        maxAge: 1000 * 60 * 60 * 2
    });
});

test("development cookies use the same-site policy without requiring HTTPS", () => {
    assert.deepEqual(buildCookieConfig(false), {
        httpOnly: true,
        secure: false,
        sameSite: "lax",
        maxAge: 1000 * 60 * 60 * 2
    });
});

test("production refuses to start without a session secret", () => {
    delete process.env.SESSION_SECRET;
    assert.throws(
        () => resolveSessionSecret(true),
        /SESSION_SECRET is required in production/
    );
});

test("production rejects short session secrets", () => {
    process.env.SESSION_SECRET = "too-short";
    assert.throws(
        () => resolveSessionSecret(true),
        /at least 32 characters/
    );
});

test("production accepts a sufficiently long session secret", () => {
    const secret = "a-secure-production-session-secret-123456";
    process.env.SESSION_SECRET = secret;
    assert.equal(resolveSessionSecret(true), secret);
});

test("development has an explicit development-only fallback", () => {
    delete process.env.SESSION_SECRET;
    assert.equal(
        resolveSessionSecret(false),
        "dev-only-session-secret-change-me"
    );
});
