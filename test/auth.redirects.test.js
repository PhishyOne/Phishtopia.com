import assert from "node:assert/strict";
import { test } from "node:test";

import {
    resolveLoginReturnTo,
    showLogin
} from "../src/controllers/auth.controller.js";
import { requireLogin } from "../src/middleware/requireLogin.js";
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

test("protected pages carry their destination through the login form", () => {
    const session = {};
    let loginLocation;

    requireLogin({
        method: "GET",
        originalUrl: "/youlist?page=2",
        session
    }, {
        redirect(location) {
            loginLocation = location;
            return location;
        }
    }, () => assert.fail("unauthenticated request must not continue"));

    assert.equal(session.returnTo, "/youlist?page=2");
    assert.equal(loginLocation, "/auth/login?returnTo=%2Fyoulist%3Fpage%3D2");

    const returnTo = new URL(loginLocation, "https://phishtopia.com").searchParams.get("returnTo");
    let rendered;
    const response = {
        status(status) {
            this.statusCode = status;
            return this;
        },
        render(view, locals) {
            rendered = { view, locals };
            return rendered;
        }
    };

    showLogin({ query: { returnTo }, session }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(rendered.view, "login");
    assert.equal(rendered.locals.returnTo, "/youlist?page=2");
    assert.equal(resolveLoginReturnTo(rendered.locals.returnTo, session.returnTo), "/youlist?page=2");
});

test("login destination resolution rejects auth and external form values", () => {
    assert.equal(resolveLoginReturnTo("/youlist", "/", "/"), "/youlist");
    assert.equal(resolveLoginReturnTo("/auth/register", null, "/"), "/");
    assert.equal(resolveLoginReturnTo("//evil.example", "/storecalc", "/"), "/storecalc");
});
