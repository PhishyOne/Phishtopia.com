import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("../", import.meta.url));

test("privacy page makes clear, bounded statements about current data practices", async () => {
    const template = await readFile(join(rootDir, "views/privacy.ejs"), "utf8");

    for (const phrase of [
        "What the site collects",
        "Passwords and account security",
        "Cookies and sessions",
        "Analytics",
        "Other services",
        "Selling and advertising",
        "Retention and deletion",
        "Security has limits"
    ]) {
        assert.ok(template.includes(phrase), `privacy page should cover ${phrase}`);
    }

    assert.match(template, /does not sell your personal information/i);
    assert.match(template, /delete your account and associated live data from the Danger zone/i);
    assert.match(template, /backup.*retention/i);
    assert.doesNotMatch(template, /Self-service account deletion is not available yet/i);
    assert.match(template, /no website or network can promise perfect security/i);
    assert.match(template, /href="\/contact"/);
});

test("shared footer contains only Contact and Privacy navigation", async () => {
    const footer = await readFile(join(rootDir, "views/partials/footer.ejs"), "utf8");
    const links = [...footer.matchAll(/<a href="([^"]+)">([^<]+)<\/a>/g)]
        .map(([, href, label]) => ({ href, label }));

    assert.deepEqual(links, [
        { href: "/contact", label: "Contact" },
        { href: "/privacy", label: "Privacy" }
    ]);
});
