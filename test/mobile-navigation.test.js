import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("../", import.meta.url));

async function read(relativePath) {
    return readFile(join(rootDir, relativePath), "utf8");
}

test("mobile navigation keeps projects and signed-in account controls available", async () => {
    const header = await read("views/partials/header.ejs");

    assert.match(header, /<details class="mobile-nav-menu">/);
    assert.match(header, /<summary aria-label="Open navigation menu">/);
    assert.match(header, /class="mobile-dashboard-link"[\s\S]*href="\/dashboard"/);

    for (const path of [
        "/dashboard",
        "/storecalc",
        "/echotrace",
        "/youlist",
        "/archive",
        "/account",
        "/contact",
        "/privacy"
    ]) {
        assert.ok(header.includes(`href="${path}"`), `mobile navigation should include ${path}`);
    }

    assert.match(header, /class="mobile-logout-item"[\s\S]*action="\/auth\/logout"/);
    assert.match(header, /class="[^"]*\bdesktop-primary-links\b[^"]*"/);
    assert.match(header, /class="[^"]*\bdesktop-account-links\b[^"]*"/);
});

test("mobile menu groups projects, site pages, and account actions", async () => {
    const header = await read("views/partials/header.ejs");

    const projectsIndex = header.indexOf(">Projects</li>");
    const siteIndex = header.indexOf(">Site</li>");
    const accountIndex = header.indexOf(">Account</li>");
    const loginIndex = header.indexOf(">Login</a>");
    const registerIndex = header.indexOf(">Register</a>");

    assert.ok(projectsIndex >= 0);
    assert.ok(siteIndex > projectsIndex);
    assert.ok(accountIndex > siteIndex);
    assert.ok(loginIndex > accountIndex);
    assert.ok(registerIndex > loginIndex);
    assert.equal((header.match(/class="mobile-project-link"/g) || []).length, 3);
    assert.equal((header.match(/class="mobile-auth-item"/g) || []).length, 2);
});

test("mobile navigation replaces crowded desktop links only at narrow widths", async () => {
    const css = await read("public/styles/navigation.css");

    assert.match(css, /\.mobile-nav-actions\s*\{\s*display:\s*none;/);
    assert.match(css, /@media\s*\(max-width:\s*820px\)/);
    assert.match(css, /\.desktop-primary-links,[\s\S]*\.desktop-account-links\s*\{\s*display:\s*none;/);
    assert.match(css, /\.mobile-nav-actions\s*\{[\s\S]*display:\s*flex;/);
    assert.match(css, /\.mobile-nav-links\s*\{[\s\S]*max-height:\s*calc\(100vh - 86px\);[\s\S]*overflow-y:\s*auto;/);
});

test("mobile menu visually separates sections and highlights projects", async () => {
    const css = await read("public/styles/navigation.css");

    assert.match(css, /\.mobile-nav-section-label\s*\{[\s\S]*border-top:/);
    assert.match(css, /\.mobile-project-link\s*\{[\s\S]*linear-gradient/);
    assert.match(css, /\.mobile-project-link\s*\{[\s\S]*box-shadow:\s*inset 3px 0 0/);
    assert.match(css, /\.mobile-auth-item a\s*\{[\s\S]*background:/);
});

test("mobile navigation controls meet the minimum touch-target contract", async () => {
    const css = await read("public/styles/navigation.css");

    assert.match(css, /\.mobile-dashboard-link\s*\{[\s\S]*min-height:\s*44px;/);
    assert.match(css, /\.mobile-nav-menu\s*>\s*summary\s*\{[\s\S]*min-height:\s*44px;/);
    assert.match(css, /\.mobile-nav-links a,[\s\S]*\.mobile-nav-links button\s*\{[\s\S]*min-height:\s*46px;/);
    assert.match(css, /:focus-visible/);
});

test("navigation stylesheet is loaded after the legacy shared stylesheet", async () => {
    const header = await read("views/partials/header.ejs");
    const mainIndex = header.indexOf('href="/styles/main.css"');
    const navigationIndex = header.indexOf('href="/styles/navigation.css"');

    assert.ok(mainIndex >= 0);
    assert.ok(navigationIndex > mainIndex);
});
