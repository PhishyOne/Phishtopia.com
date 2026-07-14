import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
    safeInternalRedirect,
    safeSameSiteReferer
} from "../src/utils/redirects.js";

const originalSiteUrl = process.env.SITE_URL;

afterEach(() => {
    if (originalSiteUrl === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = originalSiteUrl;
});

test("safeInternalRedirect preserves valid application paths", () => {
    assert.equal(
        safeInternalRedirect("/youlist?page=2#comments"),
        "/youlist?page=2#comments"
    );
});

test("safeInternalRedirect rejects external and protocol-relative targets", () => {
    assert.equal(safeInternalRedirect("https://evil.example/path"), "/");
    assert.equal(safeInternalRedirect("//evil.example/path"), "/");
    assert.equal(safeInternalRedirect("javascript:alert(1)"), "/");
});

test("safeInternalRedirect rejects malformed and backslash-based targets", () => {
    assert.equal(safeInternalRedirect("/%"), "/");
    assert.equal(safeInternalRedirect("/\\evil.example"), "/");
    assert.equal(safeInternalRedirect("/%5Cevil.example"), "/");
});

test("safeInternalRedirect supports a null fallback when no target should be stored", () => {
    assert.equal(safeInternalRedirect("https://evil.example", null), null);
});

test("safeSameSiteReferer preserves same-site absolute URLs", () => {
    process.env.SITE_URL = "https://phishtopia.com";

    assert.equal(
        safeSameSiteReferer("https://phishtopia.com/echotrace?name=test#results"),
        "/echotrace?name=test#results"
    );
});

test("safeSameSiteReferer rejects foreign origins", () => {
    process.env.SITE_URL = "https://phishtopia.com";

    assert.equal(
        safeSameSiteReferer("https://evil.example/steal-session"),
        "/"
    );
});
