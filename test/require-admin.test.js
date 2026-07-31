import assert from "node:assert/strict";
import test from "node:test";

import { requireAdmin } from "../src/middleware/requireAdmin.js";

function makeResponse() {
    return {
        statusCode: 200,
        contentType: null,
        body: null,
        redirectTo: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        type(contentType) {
            this.contentType = contentType;
            return this;
        },
        send(body) {
            this.body = body;
            return this;
        },
        redirect(location) {
            this.redirectTo = location;
            return this;
        }
    };
}

test("requireAdmin allows an authenticated admin", () => {
    const req = {
        method: "GET",
        originalUrl: "/admin",
        session: { user: { id: 1, username: "PhishyOne", role: "admin" } }
    };
    const res = makeResponse();
    let nextCalled = false;

    requireAdmin(req, res, () => {
        nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.equal(res.statusCode, 200);
    assert.equal(res.redirectTo, null);
});

test("requireAdmin rejects an authenticated non-admin", () => {
    const req = {
        method: "GET",
        originalUrl: "/admin",
        session: { user: { id: 2, username: "member", role: "user" } }
    };
    const res = makeResponse();
    let nextCalled = false;

    requireAdmin(req, res, () => {
        nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
    assert.equal(res.contentType, "text/plain");
    assert.equal(res.body, "Forbidden");
});

test("requireAdmin redirects an unauthenticated GET and preserves returnTo", () => {
    const req = {
        method: "GET",
        originalUrl: "/admin/users?query=fish",
        session: {}
    };
    const res = makeResponse();

    requireAdmin(req, res, () => {
        assert.fail("next should not be called");
    });

    assert.equal(req.session.returnTo, "/admin/users?query=fish");
    assert.equal(
        res.redirectTo,
        "/auth/login?returnTo=%2Fadmin%2Fusers%3Fquery%3Dfish"
    );
});

test("requireAdmin redirects an unauthenticated non-GET without storing returnTo", () => {
    const req = {
        method: "POST",
        originalUrl: "/admin/users/2",
        session: {}
    };
    const res = makeResponse();

    requireAdmin(req, res, () => {
        assert.fail("next should not be called");
    });

    assert.equal(req.session.returnTo, undefined);
    assert.equal(res.redirectTo, "/auth/login");
});
