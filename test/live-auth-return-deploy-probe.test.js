import assert from "node:assert/strict";
import { test } from "node:test";

const marker = "0f208c9";
const protectedPath = `/youlist?authReturnCheck=${marker}`;
const expectedLocation = `/auth/login?returnTo=${encodeURIComponent(protectedPath)}`;
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

test("live production deploy preserves the YouList return target", { timeout: 330_000 }, async () => {
    for (let attempt = 1; attempt <= 20; attempt += 1) {
        const protectedResponse = await fetch(`https://phishtopia.com${protectedPath}`, {
            redirect: "manual",
            headers: {
                "cache-control": "no-cache",
                pragma: "no-cache"
            }
        });
        const location = protectedResponse.headers.get("location");
        console.log(`LIVE_AUTH attempt=${attempt} status=${protectedResponse.status} location=${location || ""}`);

        if (protectedResponse.status === 302 && location === expectedLocation) {
            const sessionCookie = protectedResponse.headers.get("set-cookie")?.split(";", 1)[0];
            assert.ok(sessionCookie, "protected redirect should establish a session cookie");

            const loginResponse = await fetch(`https://phishtopia.com${location}`, {
                redirect: "manual",
                headers: {
                    cookie: sessionCookie,
                    "cache-control": "no-cache",
                    pragma: "no-cache"
                }
            });
            const html = await loginResponse.text();
            console.log(`LIVE_LOGIN status=${loginResponse.status} hiddenReturn=${html.includes(`name="returnTo" value="${protectedPath}"`)}`);

            assert.equal(loginResponse.status, 200);
            assert.match(html, new RegExp(`name="returnTo" value="${protectedPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
            return;
        }

        if (attempt < 20) await delay(15_000);
    }

    assert.fail(`live production did not expose ${expectedLocation} within the deployment window`);
});
