import express from "express";
import { existsSync, readdirSync } from "fs";
import { join } from "path";
import {
    appBreweryPublicDir,
    appBreweryStaticViewsDir,
    projectAssetsDir,
    publicDir
} from "../config/paths.js";

export function registerStaticAssets(app) {
    app.use(express.static(publicDir));
    app.use("/static", express.static(appBreweryStaticViewsDir));
    app.use("/projects/assets", express.static(projectAssetsDir));

    if (!existsSync(appBreweryPublicDir)) return;

    readdirSync(appBreweryPublicDir, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .forEach(dirent => {
            const projectName = dirent.name;
            app.use(`/${projectName}`, express.static(join(appBreweryPublicDir, projectName)));
        });
}
