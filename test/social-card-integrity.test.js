import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("../", import.meta.url));

const REVIEWED_SHARE_CARD_BLOBS = new Map([
    ["archive.png", "6b3ab9a02489d0ec8e241c82dc8bb1dcd69ec8cf"],
    ["contact.png", "8397452800f63182e4f32bb7782d588724dd4bc9"],
    ["echotrace.png", "33a499930241aab94a55db831478c5e28e070b66"],
    ["home.png", "24615efee5e637ce369534fad775d955bee9aa2f"],
    ["privacy.png", "31a6887830a04ac5280ccb55bc96bece0bf5e6b4"],
    ["storecalc.png", "470f06c9d7d9b922166a6933caabc772f07da905"],
    ["youlist.png", "ba95ecb134f856b340e1f82d33264c6dc1044c3b"]
]);

function gitBlobHash(content) {
    return createHash("sha1")
        .update(`blob ${content.length}\0`)
        .update(content)
        .digest("hex");
}

test("social preview cards match the visually reviewed opaque PNG files", async () => {
    for (const [fileName, expectedBlob] of REVIEWED_SHARE_CARD_BLOBS) {
        const image = await readFile(join(rootDir, "public/share", fileName));
        const actualBlob = gitBlobHash(image);

        assert.equal(actualBlob, expectedBlob, `${fileName} should match the reviewed asset`);
        assert.deepEqual(
            [...image.subarray(0, 8)],
            [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
            `${fileName} should have a valid PNG signature`
        );
        assert.equal(image.readUInt32BE(16), 1200, `${fileName} should be 1200 pixels wide`);
        assert.equal(image.readUInt32BE(20), 630, `${fileName} should be 630 pixels tall`);
        assert.equal(image[25], 2, `${fileName} should be opaque truecolor without an alpha channel`);
    }
});
