import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

const RETIRED_PATHS = [
    "app-brewery-server",
    "views/app-brewery-static",
    "views/project25",
    "views/project28",
    "views/project29",
    "views/project30",
    "views/project33-1",
    "views/project33-2",
    "views/project33-3",
    "views/project34",
    "public/project34",
    "public/styles/app-brewery.css",
    "docs/REFACTOR_PLAN.md"
];

test("retired course source and assets are absent from the working tree", async () => {
    for (const relativePath of RETIRED_PATHS) {
        await assert.rejects(
            access(join(rootDir, relativePath)),
            error => error?.code === "ENOENT",
            `${relativePath} should not exist in the working tree`
        );
    }
});

test("course archive links target the preserved branch instead of deleted main paths", async () => {
    const archive = await readFile(join(rootDir, "docs/course-project-archive.md"), "utf8");

    assert.match(archive, /archive\/course-projects-2026-07-28/);
    assert.doesNotMatch(
        archive,
        /(?:tree|blob)\/main\/(?:app-brewery-server|views\/app-brewery-static|views\/project(?:25|28|29|30|33-[123]|34))/
    );
});
