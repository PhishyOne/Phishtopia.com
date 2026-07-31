import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { showRegister } from "../src/controllers/auth.controller.js";
import {
    PASSWORD_MAX_LENGTH,
    PASSWORD_MIN_LENGTH,
    PASSWORD_REQUIREMENTS_TEXT,
    passwordLengthError
} from "../src/security/passwordPolicy.js";
import { changeAccountPassword } from "../src/services/account.service.js";
import { registerUser } from "../src/services/auth.service.js";

const rootDir = fileURLToPath(new URL("../", import.meta.url));

function fakeRenderResponse() {
    return {
        statusCode: null,
        view: null,
        locals: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        render(view, locals) {
            this.view = view;
            this.locals = locals;
            return this;
        }
    };
}

test("password policy accepts 8 through 128 characters", () => {
    assert.equal(PASSWORD_MIN_LENGTH, 8);
    assert.equal(PASSWORD_MAX_LENGTH, 128);
    assert.match(PASSWORD_REQUIREMENTS_TEXT, /8.+128/);
    assert.equal(passwordLengthError("a".repeat(8)), null);
    assert.equal(passwordLengthError("a".repeat(128)), null);
    assert.match(passwordLengthError("a".repeat(7)), /between 8 and 128/i);
    assert.match(passwordLengthError("a".repeat(129)), /between 8 and 128/i);
});

test("registration rejects passwords outside the policy before database access", async () => {
    for (const password of ["a".repeat(7), "a".repeat(129)]) {
        let lookupCalled = false;
        const result = await registerUser({
            username: "new-user",
            password,
            confirmPassword: password,
            email: "user@example.com"
        }, {
            findExistingUser: async () => {
                lookupCalled = true;
                return null;
            }
        });

        assert.equal(result.ok, false);
        assert.equal(result.status, 400);
        assert.match(result.error, /between 8 and 128/i);
        assert.equal(lookupCalled, false);
    }
});

test("account password changes use the same policy before account access", async () => {
    let accountLookupCalled = false;
    const result = await changeAccountPassword({
        userId: 7,
        currentPassword: "old-password",
        newPassword: "short",
        confirmPassword: "short"
    }, {
        findAccount: async () => {
            accountLookupCalled = true;
            return null;
        }
    });

    assert.equal(result.ok, false);
    assert.match(result.error, /between 8 and 128/i);
    assert.equal(accountLookupCalled, false);
});

test("registration renders clear browser-visible password requirements", async () => {
    const response = fakeRenderResponse();
    showRegister({}, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.view, "register");
    assert.equal(response.locals.passwordMinLength, 8);
    assert.equal(response.locals.passwordMaxLength, 128);
    assert.equal(response.locals.passwordRequirements, PASSWORD_REQUIREMENTS_TEXT);

    const template = await readFile(join(rootDir, "views/register.ejs"), "utf8");
    assert.match(template, /password-requirements/);
    assert.match(template, /minlength="<%= passwordMinLength %>"/);
    assert.match(template, /maxlength="<%= passwordMaxLength %>"/);
    assert.match(template, /aria-describedby="password-requirements"/);
});
