import express from "express";
import { publicDir } from "../config/paths.js";

export function registerStaticAssets(app) {
    app.use(express.static(publicDir));
}
