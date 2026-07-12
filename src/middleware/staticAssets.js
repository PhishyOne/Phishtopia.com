import express from "express";
import { projectAssetsDir, publicDir } from "../config/paths.js";

export function registerStaticAssets(app) {
    app.use(express.static(publicDir));
    app.use("/projects/assets", express.static(projectAssetsDir));
}
