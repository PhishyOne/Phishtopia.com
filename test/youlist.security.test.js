import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
    ensureCsrfToken,
    requireCsrfToken
} from "../src/middleware/csrf.js";
import {
    YOU_LIST_MAX_COMMENT_LENGTH,
    isValidMediaType,
    normalizeComment,
    normalizePage,
    normalizePositiveInteger,
    normalizeSearchQuery
} from "../src/services/youlist.validation.js";

function responseRecorder() {
    return {
        statusCode: 200,
        body: null,
        status(value) {
            this.statusCode = value;
            return this;
        },
        json(value) {
            this.body = value;
            return this;
        }
    };
}

test("CSRF tokens are generated once per session", () => {
    const req = { session: {} };
    const first = ensureCsrfToken(req);
    const second = ensureCsrfToken(req);

    assert.match(first, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(second, first);
});

test("CSRF middleware rejects missing and incorrect tokens", () => {
    const token = ensureCsrfToken({ session: {} });

    for (const supplied of [undefined, "A".repeat(43)]) {
        const req = {
            session: { csrfToken: token },
            get(name) {
                assert.equal(name, "x-csrf-token");
                return supplied;
            }
        };
        const res = responseRecorder();
        let nextCalled = false;
        requireCsrfToken(req, res, () => { nextCalled = true; });
        assert.equal(nextCalled, false);
        assert.equal(res.statusCode, 403);
        assert.deepEqual(res.body, { success: false, error: "Invalid request token" });
    }
});

test("CSRF middleware accepts the session token", () => {
    const req = { session: {} };
    const token = ensureCsrfToken(req);
    req.get = () => token;
    const res = responseRecorder();
    let nextCalled = false;

    requireCsrfToken(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    assert.equal(res.statusCode, 200);
});

test("YouList identifiers and media types are strictly validated", () => {
    assert.equal(normalizePositiveInteger("42"), 42);
    assert.equal(normalizePositiveInteger(42), 42);
    for (const value of ["0", "-1", "1.5", "1e3", " 2", "2 ", "abc", null, 2147483648]) {
        assert.equal(normalizePositiveInteger(value), null);
    }
    assert.equal(isValidMediaType("movie"), true);
    assert.equal(isValidMediaType("tv"), true);
    assert.equal(isValidMediaType("person"), false);
});

test("YouList comments are trimmed and bounded", () => {
    assert.equal(normalizeComment("  useful note  "), "useful note");
    assert.equal(normalizeComment("   "), null);
    assert.equal(normalizeComment("x".repeat(YOU_LIST_MAX_COMMENT_LENGTH)), "x".repeat(YOU_LIST_MAX_COMMENT_LENGTH));
    assert.equal(normalizeComment("x".repeat(YOU_LIST_MAX_COMMENT_LENGTH + 1)), null);
    assert.equal(normalizeComment({}), null);
});

test("YouList search and page inputs are bounded", () => {
    assert.equal(normalizeSearchQuery("  Alien  "), "Alien");
    assert.equal(normalizeSearchQuery("x".repeat(101)), null);
    assert.equal(normalizePage("2"), 2);
    assert.equal(normalizePage("0"), 1);
    assert.equal(normalizePage("10001"), 1);
});

test("YouList client rendering does not inject API data through innerHTML", async () => {
    const source = await readFile(new URL("../public/js/youlist.js", import.meta.url), "utf8");
    assert.doesNotMatch(source, /\.innerHTML\s*=/);
    assert.doesNotMatch(source, /insertAdjacentHTML/);
    assert.match(source, /textContent/);
    assert.match(source, /X-CSRF-Token/);
});

test("YouList page exposes only escaped data attributes and input limits", async () => {
    const template = await readFile(new URL("../views/youlist/index.ejs", import.meta.url), "utf8");
    assert.match(template, /data-current-user-id="<%= user\?\.id \|\| '' %>"/);
    assert.match(template, /data-csrf-token="<%= csrfToken %>"/);
    assert.doesNotMatch(template, /<%- JSON\.stringify\(user/);
    assert.doesNotMatch(template, /project34/);
    assert.match(template, /\/images\/youlist-placeholder\.jpg/);
    assert.match(template, /maxlength="1000"/);
    assert.match(template, /maxlength="100"/);
});

test("YouList controller and TMDB fallback use canonical feature paths", async () => {
    const controller = await readFile(new URL("../src/controllers/youlist.controller.js", import.meta.url), "utf8");
    const tmdbService = await readFile(new URL("../src/services/tmdb.service.js", import.meta.url), "utf8");

    assert.match(controller, /res\.render\("youlist"/);
    assert.doesNotMatch(controller, /project34/);
    assert.match(tmdbService, /\/images\/youlist-placeholder\.jpg/);
    assert.doesNotMatch(tmdbService, /project34/);
});
