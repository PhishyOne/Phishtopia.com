import assert from "node:assert/strict";
import { test } from "node:test";

import { safePostLoginRedirect } from "../src/utils/redirects.js";

test("post-login redirects preserve application destinations", () => {
    assert.equal(safePostLoginRedirect("/youlist?page=2"), "/youlist?page=2");
    assert.equal(safePostLoginRedirect("/storecalc#calculator"), "/storecalc#calculator");
});

test("post-login redirects reject authentication destinations", () => {
    assert.equal(safePostLoginRedirect("/auth/register"), "/");
    assert.equal(safePostLoginRedirect("/auth/login?returnTo=%2Fyoulist"), "/");
    assert.equal(safePostLoginRedirect("/auth/verify-email?token=secret"), "/");
    assert.equal(safePostLoginRedirect("/auth/resend-verification"), "/");
});

test("post-login redirects still reject external and malformed values", () => {
    assert.equal(safePostLoginRedirect("//evil.example/path"), "/");
    assert.equal(safePostLoginRedirect("https://evil.example/path"), "/");
    assert.equal(safePostLoginRedirect("/%E0%A4%A"), "/");
    assert.equal(safePostLoginRedirect(null), "/");
});
