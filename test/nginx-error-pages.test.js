import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("../", import.meta.url));
const statuses = Object.freeze({
  502: {
    eyebrow: "Bad gateway",
    title: "The current was interrupted.",
    message: "Phishtopia’s gateway could not reach the application."
  },
  503: {
    eyebrow: "Service unavailable",
    title: "The tank is temporarily offline.",
    message: "Maintenance is underway. Please surface again shortly."
  },
  504: {
    eyebrow: "Gateway timeout",
    title: "Something is taking too long in the depths.",
    message: "The request timed out before the current returned."
  }
});

const nginxSnippet = join(rootDir, "ops", "nginx", "phishtopia-upstream-errors.conf");

test("static upstream-error pages are self-contained and status-specific", async () => {
  for (const [status, expected] of Object.entries(statuses)) {
    const html = await readFile(
      join(rootDir, "public", "__system-errors", `${status}.html`),
      "utf8"
    );

    assert.match(html, /<!doctype html>/i);
    assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
    assert.match(html, new RegExp(`<title>${status} ${expected.eyebrow.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\| Phishtopia</title>`));
    assert.ok(html.includes(expected.title));
    assert.ok(html.includes(expected.message));
    assert.match(html, new RegExp(`/__system-errors/${status}\\.webp`));
    assert.match(html, /\/__system-errors\/logo\.png/);
    assert.match(html, /\/__system-errors\/upstream-errors\.css/);
    assert.match(html, /href="\/">Back Home<\/a>/);
    assert.match(html, /href="">Try Again<\/a>/);
    assert.doesNotMatch(html, /<script\b/i);
    assert.doesNotMatch(html, /javascript:/i);
    assert.doesNotMatch(html, /https?:\/\//i);
  }
});

test("shared upstream-error CSS is local, responsive, and script-free", async () => {
  const css = await readFile(
    join(rootDir, "public", "__system-errors", "upstream-errors.css"),
    "utf8"
  );

  assert.match(css, /var\(--scene\)/);
  assert.match(css, /@media \(max-width: 700px\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.doesNotMatch(css, /https?:\/\//i);
  assert.doesNotMatch(css, /javascript:/i);
});

test("Nginx snippet intercepts only the three upstream statuses with internal documents", async () => {
  const config = await readFile(nginxSnippet, "utf8");

  assert.match(config, /\bproxy_intercept_errors\s+on;/);

  for (const status of Object.keys(statuses)) {
    assert.match(
      config,
      new RegExp(`error_page\\s+${status}\\s+/__system-errors/${status}\\.html;`)
    );
    assert.match(
      config,
      new RegExp(`location\\s+=\\s+/__system-errors/${status}\\.html\\s*\\{[\\s\\S]*?\\binternal;[\\s\\S]*?alias\\s+/home/codespace/phishtopia/public/__system-errors/${status}\\.html;[\\s\\S]*?\\}`, "m")
    );
    assert.match(
      config,
      new RegExp(`location\\s+=\\s+/__system-errors/${status}\\.webp\\s*\\{[\\s\\S]*?alias\\s+/home/codespace/phishtopia/public/images/errors/${status}\\.webp;[\\s\\S]*?\\}`, "m")
    );
  }

  assert.match(
    config,
    /location\s+=\s+\/__system-errors\/upstream-errors\.css\s*\{[\s\S]*?alias\s+\/home\/codespace\/phishtopia\/public\/__system-errors\/upstream-errors\.css;[\s\S]*?\}/m
  );

  assert.match(
    config,
    /location\s+=\s+\/__system-errors\/logo\.png\s*\{[\s\S]*?alias\s+\/home\/codespace\/phishtopia\/public\/images\/phishLogo\.png;[\s\S]*?\}/m
  );
  assert.doesNotMatch(config, /\bproxy_pass\b/);
  assert.doesNotMatch(config, /\breturn\s+200\b/);
  assert.doesNotMatch(config, /\$\{|\$http_|\$arg_/);
});

test("Nginx accepts the reviewed include when the binary is available", async (t) => {
  const version = spawnSync("nginx", ["-v"], { encoding: "utf8" });
  if (version.error?.code === "ENOENT") {
    t.skip("nginx is not installed on this runner");
    return;
  }
  assert.equal(version.status, 0, version.stderr || version.stdout);

  const directory = await mkdtemp(join(tmpdir(), "phishtopia-nginx-test-"));
  try {
    const configPath = join(directory, "nginx.conf");
    await writeFile(configPath, `
pid ${join(directory, "nginx.pid")};
error_log stderr;
events {}
http {
  access_log off;
  server {
    listen 127.0.0.1:8080;
    include ${nginxSnippet};
    location / {
      proxy_pass http://127.0.0.1:9;
    }
  }
}
`, "utf8");

    const result = spawnSync(
      "nginx",
      ["-t", "-p", `${directory}/`, "-c", configPath],
      { encoding: "utf8" }
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("upstream-error runbook documents safe activation, verification, and rollback", async () => {
  const readme = await readFile(
    join(rootDir, "ops", "nginx", "README.md"),
    "utf8"
  );

  assert.match(readme, /sudo nginx -t/);
  assert.match(readme, /sudo systemctl reload nginx/);
  assert.match(readme, /rollback/i);
  assert.match(readme, /root-owned/i);
  assert.match(readme, /API limitation/);
  assert.doesNotMatch(readme, /rm -rf|chmod 777|curl .*\|\s*(?:sh|bash)/);
});