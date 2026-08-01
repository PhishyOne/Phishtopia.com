import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("../", import.meta.url));

const REVIEWED_SHARE_CARD_BLOBS = new Map([
    ["archive.png", "ddfecf793d3d253495005682e0e42fcedc18e2a8"],
    ["contact.png", "82953aa7b74d2dd545d7ab123552cda6bf11ed96"],
    ["echotrace.png", "a1c62a55c5fe4b4582c98591cdcbc9ff6b481bb5"],
    ["home.png", "832fade2755df22cb198007318ec8f0e4b5a12bc"],
    ["privacy.png", "beb4612c201cd6864bc94ccfa2a8a8e38741aa19"],
    ["storecalc.png", "c8f462a32f2a8aec69512a98efc67c00493a6c89"],
    ["youlist.png", "f3f46599a5f0409cc4f66d10a096b91c58d89aa5"]
]);

function gitBlobHash(content) {
    return createHash("sha1")
        .update(`blob ${content.length}\0`)
        .update(content)
        .digest("hex");
}

test("social preview cards match the visually reviewed PNG files", async () => {
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
    }
});
