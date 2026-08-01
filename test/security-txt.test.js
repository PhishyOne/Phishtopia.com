import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("../", import.meta.url));
const securityTxtPath = join(rootDir, "public", ".well-known", "security.txt");
const canonicalUrl = "https://phishtopia.com/.well-known/security.txt";

function parseFields(content) {
    const fields = new Map();

    for (const line of content.split("\n")) {
        if (!line || line.startsWith("#")) continue;
        const separator = line.indexOf(":");
        assert.ok(separator > 0, `invalid security.txt line: ${line}`);
        const name = line.slice(0, separator);
        const value = line.slice(separator + 1).trim();
        assert.ok(value, `${name} must have a value`);
        const values = fields.get(name) || [];
        values.push(value);
        fields.set(name, values);
    }

    return fields;
}

test("security.txt publishes the approved private reporting channels", async () => {
    const content = await readFile(securityTxtPath, "utf8");
    const fields = parseFields(content);

    assert.deepEqual(fields.get("Contact"), [
        "https://github.com/PhishyOne/Phishtopia.com/security/advisories/new",
        "mailto:security@phishtopia.com"
    ]);
    assert.deepEqual(fields.get("Preferred-Languages"), ["en"]);
    assert.deepEqual(fields.get("Canonical"), [canonicalUrl]);
    assert.deepEqual(fields.get("Policy"), [
        "https://github.com/PhishyOne/Phishtopia.com/security/policy"
    ]);

    const expires = Date.parse(fields.get("Expires")?.[0] || "");
    assert.ok(Number.isFinite(expires), "Expires must be a valid timestamp");
    assert.ok(
        expires - Date.now() > 30 * 24 * 60 * 60 * 1000,
        "security.txt must be renewed at least 30 days before expiration"
    );
});

let server;
let baseUrl;

before(async () => {
    process.env.NODE_ENV = "test";
    process.env.SESSION_SECRET = "test-only-session-secret-that-is-long-enough";
    process.env.SITE_URL = "https://phishtopia.com";
    process.env.PREWARM_TMDB_CACHE = "false";
    delete process.env.DATABASE_URL;
    delete process.env.DB_HOST;

    const { createApp } = await import("../src/app.js");
    const app = await createApp();
    await new Promise((resolve, reject) => {
        server = app.listen(0, "127.0.0.1", error => error ? reject(error) : resolve());
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    if (!server?.listening) return;
    await new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
    });
});

test("the canonical well-known endpoint serves only the public security policy file", async () => {
    const expected = await readFile(securityTxtPath, "utf8");
    const response = await fetch(`${baseUrl}/.well-known/security.txt`, { redirect: "manual" });

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") || "", /^text\/plain\b/);
    assert.match(response.headers.get("cache-control") || "", /public/);
    assert.equal(await response.text(), expected);

    const environmentFile = await fetch(`${baseUrl}/.env`, { redirect: "manual" });
    assert.equal(environmentFile.status, 404);
});
