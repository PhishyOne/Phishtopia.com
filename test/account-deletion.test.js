import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { deleteAccount } from "../src/services/account.service.js";

const rootDir = fileURLToPath(new URL("../", import.meta.url));

function accountRecord(overrides = {}) {
    return {
        id: 7,
        username: "PhishyOne",
        email: "user@example.com",
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

test("account deletion rejects an incorrect confirmation before database access", async () => {
    let connected = false;

    const result = await deleteAccount({
        userId: 7,
        currentPassword: "correct-password",
        confirmation: "delete"
    }, {
        connectDb: async () => {
            connected = true;
            return fakeClient();
        }
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
    assert.match(result.error, /type DELETE exactly/i);
    assert.equal(connected, false);
});

test("account deletion rolls back when the current password is wrong", async () => {
    const client = fakeClient();
    let deletionCalls = 0;

    const result = await deleteAccount({
        userId: 7,
        currentPassword: "wrong-password",
        confirmation: "DELETE"
    }, {
        connectDb: async () => client,
        findAccountForDeletion: async () => accountRecord(),
        comparePassword: async () => false,
        deleteSessions: async () => { deletionCalls += 1; },
        deleteYouListData: async () => { deletionCalls += 1; },
        deleteUserRecord: async () => { deletionCalls += 1; }
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
    assert.match(result.error, /current password/i);
    assert.equal(deletionCalls, 0);
    assert.deepEqual(client.queries, ["BEGIN", "ROLLBACK"]);
    assert.equal(client.released, true);
});

test("account deletion removes only the authenticated account data in one transaction", async () => {
    const client = fakeClient();
    const operations = [];

    const result = await deleteAccount({
        userId: 7,
        currentPassword: "correct-password",
        confirmation: "DELETE"
    }, {
        connectDb: async () => client,
        findAccountForDeletion: async (userId, executor) => {
            assert.equal(userId, 7);
            assert.equal(executor, client);
            operations.push("lock-account");
            return accountRecord();
        },
        comparePassword: async (password, hash) => {
            assert.equal(password, "correct-password");
            assert.equal(hash, "stored-hash");
            operations.push("verify-password");
            return true;
        },
        deleteSessions: async (userId, executor) => {
            assert.equal(userId, 7);
            assert.equal(executor, client);
            operations.push("delete-sessions");
        },
        deleteYouListData: async (userId, executor) => {
            assert.equal(userId, 7);
            assert.equal(executor, client);
            operations.push("delete-youlist");
        },
        deleteUserRecord: async (userId, executor) => {
            assert.equal(userId, 7);
            assert.equal(executor, client);
            operations.push("delete-user");
            return { id: 7 };
        }
    });

    assert.deepEqual(result, { ok: true, deletedUserId: 7 });
    assert.deepEqual(operations, [
        "lock-account",
        "verify-password",
        "delete-sessions",
        "delete-youlist",
        "delete-user"
    ]);
    assert.deepEqual(client.queries, ["BEGIN", "COMMIT"]);
    assert.equal(client.released, true);
});

test("account deletion rolls back the entire transaction when owned-data removal fails", async () => {
    const client = fakeClient();
    let deletedUser = false;

    await assert.rejects(() => deleteAccount({
        userId: 7,
        currentPassword: "correct-password",
        confirmation: "DELETE"
    }, {
        connectDb: async () => client,
        findAccountForDeletion: async () => accountRecord(),
        comparePassword: async () => true,
        deleteSessions: async () => {},
        deleteYouListData: async () => {
            throw new Error("simulated deletion failure");
        },
        deleteUserRecord: async () => {
            deletedUser = true;
            return { id: 7 };
        }
    }), /simulated deletion failure/);

    assert.equal(deletedUser, false);
    assert.deepEqual(client.queries, ["BEGIN", "ROLLBACK"]);
    assert.equal(client.released, true);
});

test("account deletion route is password-confirmed, rate-limited, and CSRF-protected", async () => {
    const routes = await readFile(join(rootDir, "src/routes/account.routes.js"), "utf8");
    const template = await readFile(join(rootDir, "views/account/index.ejs"), "utf8");

    assert.match(routes, /router\.post\("\/delete", accountDeletionLimiter, requireFormCsrfToken, deleteAccount\)/);
    assert.equal((template.match(/name="_csrf"/g) || []).length, 4);
    assert.match(template, /action="\/account\/delete"/);
    assert.match(template, /name="currentPassword"/);
    assert.match(template, /name="confirmation"/);
    assert.match(template, /pattern="DELETE"/);
    assert.doesNotMatch(routes, /req\.body\.userId|req\.query\.userId/);
});

test("privacy page points users to live self-service deletion", async () => {
    const privacy = await readFile(join(rootDir, "views/privacy.ejs"), "utf8");

    assert.match(privacy, /delete your account and associated live data from the Danger zone/i);
    assert.match(privacy, /backup.*retention/i);
    assert.doesNotMatch(privacy, /Self-service account deletion is not available yet/i);
});
