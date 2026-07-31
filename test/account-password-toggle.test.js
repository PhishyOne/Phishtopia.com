import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("../", import.meta.url));

test("account password controls use the modern eye and eye-off masks", async () => {
    const css = await readFile(join(rootDir, "public/styles/password-toggle.css"), "utf8");
    const account = await readFile(join(rootDir, "views/account/index.ejs"), "utf8");

    assert.match(css, /\.password-toggle,\s*\.account-password-toggle\s*\{/);
    assert.match(css, /\.account-password-toggle::before/);
    assert.match(css, /\.account-password-toggle\[aria-pressed="true"\]::before/);
    assert.match(css, /\.account-password-toggle\s*\{[\s\S]*font-size:\s*0;/);
    assert.ok((account.match(/class="account-password-toggle"/g) || []).length >= 5);
});
