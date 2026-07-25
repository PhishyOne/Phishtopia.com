import assert from "node:assert/strict";
import { test } from "node:test";

import { createVerifyEmailHandler } from "../src/controllers/auth.controller.js";
import {
    registerUser,
    resendVerificationEmail,
    verifyEmailToken
} from "../src/services/auth.service.js";
import {
    createEmailVerificationToken,
    EMAIL_VERIFICATION_TOKEN_TTL_MS,
    inspectEmailVerificationToken
} from "../src/security/emailVerificationToken.js";

function fixedEntropy(byte = 0xab) {
    return () => Buffer.alloc(32, byte);
}

function fakeClient() {
    const queries = [];
    return {
        queries,
        async query(sql) {
            queries.push(sql);
            return { rows: [] };
        },
        releaseCalled: false,
        release() {
            this.releaseCalled = true;
        }
    };
}

function fakeResponse() {
    return {
        headers: new Map(),
        statusCode: 200,
        contentType: null,
        body: null,
        set(name, value) {
            this.headers.set(name.toLowerCase(), value);
            return this;
        },
        status(code) {
            this.statusCode = code;
            return this;
        },
        type(value) {
            this.contentType = value;
            return this;
        },
        send(value) {
            this.body = value;
            return this;
        }
    };
}

test("new verification tokens carry a 24-hour expiry and 256 bits of entropy", () => {
    const now = 1_700_000_000_000;
    const result = createEmailVerificationToken({
        now,
        randomBytes: fixedEntropy()
    });

    assert.equal(result.expiresAt, now + EMAIL_VERIFICATION_TOKEN_TTL_MS);
    assert.match(result.token, /^v1\.[0-9a-z]+\.[0-9a-f]{64}$/);

    const inspected = inspectEmailVerificationToken(result.token, { now });
    assert.deepEqual(inspected, {
        ok: true,
        legacy: false,
        expiresAt: result.expiresAt
    });
});

test("expired and malformed tokens fail before any database lookup", async () => {
    const now = 10_000;
    const { token } = createEmailVerificationToken({
        now,
        ttlMs: 1_000,
        randomBytes: fixedEntropy(0xcd)
    });
    let lookupCount = 0;
    const verifyByToken = async () => {
        lookupCount += 1;
        return { username: "unexpected" };
    };

    const expired = await verifyEmailToken(token, {
        now: now + 1_001,
        verifyByToken
    });
    assert.equal(expired.status, 410);
    assert.match(expired.message, /expired/i);

    const malformed = await verifyEmailToken("not-a-token", { verifyByToken });
    assert.equal(malformed.status, 400);
    assert.match(malformed.message, /invalid/i);
    assert.equal(lookupCount, 0);
});

test("valid tokens verify once and reused tokens return a client error", async () => {
    const now = 20_000;
    const { token } = createEmailVerificationToken({
        now,
        randomBytes: fixedEntropy(0xef)
    });

    const verified = await verifyEmailToken(token, {
        now,
        verifyByToken: async supplied => supplied === token ? { username: "test-user" } : null
    });
    assert.deepEqual(verified, {
        ok: true,
        status: 200,
        message: "Email verified! You can now log in."
    });

    const reused = await verifyEmailToken(token, {
        now,
        verifyByToken: async () => null
    });
    assert.equal(reused.status, 400);
    assert.match(reused.message, /already been used/i);
});

test("legacy one-time tokens remain usable during the transition", async () => {
    const legacyToken = "a".repeat(64);
    let observedToken = null;

    const result = await verifyEmailToken(legacyToken, {
        verifyByToken: async token => {
            observedToken = token;
            return { username: "legacy-user" };
        }
    });

    assert.equal(result.ok, true);
    assert.equal(observedToken, legacyToken);
});

test("registration stores and emails the same expiring token inside one transaction", async () => {
    const now = 30_000;
    const client = fakeClient();
    let created = null;
    let emailed = null;

    const result = await registerUser({
        username: "new-user",
        password: "password123",
        confirmPassword: "password123",
        email: "User@Example.com"
    }, {
        now,
        randomBytes: fixedEntropy(0x11),
        findExistingUser: async () => null,
        hashPassword: async () => "hashed-password",
        connectDb: async () => client,
        createUserRecord: async payload => {
            created = payload;
            return { id: 1 };
        },
        sendEmail: async payload => {
            emailed = payload;
            return { sent: true, verifyUrl: "https://phishtopia.com/auth/verify-email?token=test" };
        }
    });

    assert.equal(result.ok, true);
    assert.equal(result.email, "user@example.com");
    assert.equal(created.verificationToken, emailed.verificationToken);
    assert.equal(emailed.expiresAt, now + EMAIL_VERIFICATION_TOKEN_TTL_MS);
    assert.deepEqual(client.queries, ["BEGIN", "COMMIT"]);
    assert.equal(client.releaseCalled, true);
});

test("resend rotates the token only for an existing unverified account", async () => {
    const now = 40_000;
    const client = fakeClient();
    let updated = null;
    let emailed = null;

    const result = await resendVerificationEmail({ email: "USER@example.com" }, {
        now,
        randomBytes: fixedEntropy(0x22),
        findByEmail: async () => ({
            id: 7,
            email: "user@example.com",
            email_verified: false
        }),
        connectDb: async () => client,
        updateVerificationToken: async payload => {
            updated = payload;
            return { id: 7 };
        },
        sendEmail: async payload => {
            emailed = payload;
            return { sent: true, verifyUrl: "https://phishtopia.com/auth/verify-email?token=test" };
        }
    });

    assert.equal(result.ok, true);
    assert.equal(result.sent, true);
    assert.equal(updated.userId, 7);
    assert.equal(updated.verificationToken, emailed.verificationToken);
    assert.deepEqual(client.queries, ["BEGIN", "COMMIT"]);
});

test("resend gives the same public result for missing and verified accounts", async () => {
    for (const user of [null, { id: 1, email: "user@example.com", email_verified: true }]) {
        let connected = false;
        const result = await resendVerificationEmail({ email: "user@example.com" }, {
            findByEmail: async () => user,
            connectDb: async () => {
                connected = true;
                return fakeClient();
            }
        });

        assert.deepEqual(result, {
            ok: true,
            email: "user@example.com",
            sent: false
        });
        assert.equal(connected, false);
    }
});

test("verification controller preserves error status and suppresses token caching", async () => {
    const handler = createVerifyEmailHandler({
        verifyToken: async () => ({
            ok: false,
            status: 410,
            message: "Verification link has expired."
        })
    });
    const response = fakeResponse();

    await handler({ query: { token: "expired" } }, response);

    assert.equal(response.statusCode, 410);
    assert.equal(response.body, "Verification link has expired.");
    assert.equal(response.contentType, "text/plain");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
});
