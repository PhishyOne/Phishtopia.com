import assert from "node:assert/strict";
import { test } from "node:test";

const RELEASE = "1d6ba34f1bad1c88a0ad3fb69fbbc7a835df9667";
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

test("live production serves the course archive gallery", { timeout: 240_000 }, async () => {
    let lastFailure = "no response";

    for (let attempt = 1; attempt <= 18; attempt += 1) {
        try {
            const response = await fetch(`https://phishtopia.com/archive?deployCheck=${RELEASE}-${attempt}`, {
                redirect: "follow",
                headers: { "cache-control": "no-cache" }
            });
            const body = await response.text();
            const cards = (body.match(/class="archive-card"/g) || []).length;

            console.log(`# LIVE_ARCHIVE attempt=${attempt} status=${response.status} cards=${cards}`);

            if (
                response.status === 200
                && body.includes("<title>Course Project Archive</title>")
                && body.includes("/styles/archive.css")
                && body.includes('href="/archive"')
                && body.includes("archive/course-projects-2026-07-28")
                && cards === 24
            ) {
                assert.equal(cards, 24);
                return;
            }

            lastFailure = `status=${response.status} cards=${cards}`;
        } catch (error) {
            lastFailure = error instanceof Error ? error.message : String(error);
            console.log(`# LIVE_ARCHIVE attempt=${attempt} error=${lastFailure}`);
        }

        if (attempt < 18) await delay(10_000);
    }

    assert.fail(`archive deployment was not observed: ${lastFailure}`);
});
