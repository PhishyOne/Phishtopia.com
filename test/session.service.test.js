import assert from "node:assert/strict";
import { test } from "node:test";

import {
    destroySession,
    establishAuthenticatedSession
} from "../src/services/session.service.js";

test("establishAuthenticatedSession regenerates before saving the user", async () => {
    const calls = [];
    const req = {
        session: {
            regenerate(callback) {
                calls.push("regenerate");
                req.session = {
                    save(saveCallback) {
                        calls.push("save");
                        saveCallback();
                    }
                };
                callback();
            }
        }
    };

    const user = { id: 7, username: "Chris" };
    await establishAuthenticatedSession(req, user);

    assert.deepEqual(calls, ["regenerate", "save"]);
    assert.deepEqual(req.session.user, user);
});

test("establishAuthenticatedSession propagates regeneration errors", async () => {
    const req = {
        session: {
            regenerate(callback) {
                callback(new Error("regeneration failed"));
            }
        }
    };

    await assert.rejects(
        establishAuthenticatedSession(req, { id: 1 }),
        /regeneration failed/
    );
});

test("destroySession destroys the current session", async () => {
    let destroyed = false;
    const req = {
        session: {
            destroy(callback) {
                destroyed = true;
                callback();
            }
        }
    };

    await destroySession(req);
    assert.equal(destroyed, true);
});

test("session helpers fail clearly when a required method is unavailable", async () => {
    await assert.rejects(
        destroySession({ session: {} }),
        /Session method unavailable: destroy/
    );
});
