import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("../", import.meta.url));

const REVIEWED_SHARE_CARD_HASHES = new Map([
    ["archive.png", "1193915bb18ed9b56f0ceb45cc8b686e433ef343ab631889efcb3c225d2d2de4"],
    ["contact.png", "959184e07d5ffc2f4d9433f38d3ffdb0194fb85559c6f70323e13d40896ab97c"],
    ["echotrace.png", "e5149a2ba124eee5277c8b45241a9e9b231189172b31ae5c09c754c21db84be8"],
    ["home.png", "a0b696340b33315514909cb0c39a40f8ab4ccb297574ceb98d8b08300128012f"],
    ["privacy.png", "d382d09bf3081a1e8bcd955b6aa8b46b78020f4e0356ff504819e59d1d56030b"],
    ["storecalc.png", "4fa6b6c4aa5c4f8b48f7b6068e6697a486154a35f040fe26736d5281ea65bc44"],
    ["youlist.png", "ca3e5aae92c4b97d1618ae2ce857185379226fb3bb783ad8dd4ea722d6118412"]
]);

test("social preview cards match the visually reviewed PNG files", async () => {
    for (const [fileName, expectedHash] of REVIEWED_SHARE_CARD_HASHES) {
        const image = await readFile(join(rootDir, "public/share", fileName));
        const actualHash = createHash("sha256").update(image).digest("hex");

        assert.equal(actualHash, expectedHash, `${fileName} should match the reviewed asset`);
        assert.deepEqual(
            [...image.subarray(0, 8)],
            [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
            `${fileName} should have a valid PNG signature`
        );
        assert.equal(image.readUInt32BE(16), 1200, `${fileName} should be 1200 pixels wide`);
        assert.equal(image.readUInt32BE(20), 630, `${fileName} should be 630 pixels tall`);
    }
});
