import assert from "node:assert/strict";
import { test } from "node:test";

import {
    changeAccountPassword,
    changeAccountUsername,
    getAccountDetails,
    requestAccountEmailChange,
    verifyAccountEmailChange
} from "../src/services/account.service.js";
import { createEmailVerificationToken } from "../src/security/emailVerificationToken.js";

function accountRecord(overrides = {}) {
    return {
        id: 7,
        username: "PhishyOne",
        email: "old@example.com",
        email_verified: true,
        pending_email: null,
        role: "admin",
        password_hash: "stored-hash",
        ...overrides
    };
}

function fakeClient() {
    return {
        queries: [],
        released: false,
        async query(sql) {
            this.queries.push(sql);
            return { rows: [] };
        },
        release() {
            this.released = true;
        }
    };
}

function fixedEntropy(byte = 0x33) {
    return () => Buffer.alloc(32, byte);
}

test("account details expose profile fields without exposing the password hash", async () => {
    const result = await getAccountDetails(7, {
        findAccount: async () => accountRecord()
    });

    assert.deepEqual(result, {
        ok: true,
        account: {
            id: 7,
            username: "PhishyOne",
            email: "old@example.com",
            emailVerified: true,
            pendingEmail: null,
            role: "admin"
        }
    });
    assert.equal(Object.hasOwn(result.account, "password_hash"), false);
});

test("username changes require the current password before opening a transaction", async () => {
    let connected = false;
    const result = await changeAccountUsername({
        userId: 7,
        username: "NewPhish",
        currentPassword: "wrong"
    }, {
        findAccount: async () => accountRecord(),
        comparePassword: async () => false,
        connectDb: async () => {
            connected = true;
            return fakeClient();
        }
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
    assert.match(result.error, /current password/i);
    assert.equal(connected, false);
});

test("username changes update the record and invalidate existing sessions transactionally", async () => {
    const client = fakeClient();
    let updatedPayload = null;
    let deletedUserId = null;

    const result = await changeAccountUsername({
        userId: 7,
        username: "NewPhish",
        currentPassword: "correct"
    }, {
        findAccount: async () => accountRecord(),
        comparePassword: async () => true,
        findUsernameConflict: async () => null,
        connectDb: async () => client,
        updateUsernameRecord: async payload => {
            updatedPayload = payload;
            return accountRecord({ username: payload.username });
        },
        deleteSessions: async userId => {
            deletedUserId = userId;
        }
    });

    assert.equal(result.ok, true);
    assert.equal(result.account.username, "NewPhish");
    assert.deepEqual(updatedPayload, { userId: 7, username: "NewPhish" });
    assert.equal(deletedUserId, 7);
    assert.deepEqual(client.queries, ["BEGIN", "COMMIT"]);
    assert.equal(client.released, true);
});

test("email changes keep the old address active and email the stored pending token", async () => {
    const now = 1_700_000_000_000;
    const client = fakeClient();
    let stored = null;
    let emailed = null;

    const result = await requestAccountEmailChange({
        userId: 7,
        email: "NEW@EXAMPLE.COM",
        currentPassword: "correct"
    }, {
        now,
        randomBytes: fixedEntropy(),
        findAccount: async () => accountRecord(),
        comparePassword: async () => true,
        findEmailConflict: async () => null,
        connectDb: async () => client,
        setPendingEmail: async payload => {
            stored = payload;
            return accountRecord({ pending_email: payload.email });
        },
        sendEmail: async payload => {
            emailed = payload;
            return { sent: true, verifyUrl: "https://phishtopia.com/account/verify-email?token=test" };
        }
    });

    assert.equal(result.ok, true);
    assert.equal(result.account.email, "old@example.com");
    assert.equal(result.account.pendingEmail, "new@example.com");
    assert.equal(stored.verificationToken, emailed.verificationToken);
    assert.equal(emailed.email, "new@example.com");
    assert.ok(emailed.expiresAt > now);
    assert.deepEqual(client.queries, ["BEGIN", "COMMIT"]);
});

test("password changes hash the new password and invalidate existing sessions", async () => {
    const client = fakeClient();
    const compared = [];
    let stored = null;
    let deletedUserId = null;

    const result = await changeAccountPassword({
        userId: 7,
        currentPassword: "old-password",
        newPassword: "new-password-123",
        confirmPassword: "new-password-123"
    }, {
        findAccount: async () => accountRecord(),
        comparePassword: async password => {
            compared.push(password);
            return password === "old-password";
        },
        hashPassword: async password => `hashed:${password}`,
        connectDb: async () => client,
        updatePasswordRecord: async payload => {
            stored = payload;
            return accountRecord();
        },
        deleteSessions: async userId => {
            deletedUserId = userId;
        }
    });

    assert.equal(result.ok, true);
    assert.deepEqual(compared, ["old-password", "new-password-123"]);
    assert.deepEqual(stored, {
        userId: 7,
        passwordHash: "hashed:new-password-123"
    });
    assert.equal(deletedUserId, 7);
    assert.deepEqual(client.queries, ["BEGIN", "COMMIT"]);
});

test("expired email-change tokens fail before database access and valid tokens update once", async () => {
    const now = 50_000;
    const { token } = createEmailVerificationToken({
        now,
        ttlMs: 1_000,
        randomBytes: fixedEntropy(0x44)
    });
    let verifyCalls = 0;

    const expired = await verifyAccountEmailChange(token, {
        now: now + 1_001,
        verifyByToken: async () => {
            verifyCalls += 1;
            return null;
        }
    });

    assert.equal(expired.status, 410);
    assert.match(expired.message, /expired/i);
    assert.equal(verifyCalls, 0);

    const valid = await verifyAccountEmailChange(token, {
        now,
        verifyByToken: async supplied => {
            verifyCalls += 1;
            return supplied === token ? { email: "new@example.com" } : null;
        }
    });

    assert.equal(valid.ok, true);
    assert.equal(valid.status, 200);
    assert.match(valid.message, /new@example\.com/);
    assert.equal(verifyCalls, 1);
});
