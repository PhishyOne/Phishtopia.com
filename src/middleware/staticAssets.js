import express from "express";
import { join } from "node:path";
import { publicDir } from "../config/paths.js";

const RETIRED_PUBLIC_PATH = /^\/(?:static(?:\/|$)|projects(?:\/|$)|project(?:25|28|29|30|33-1|33-2|33-3|34)(?:\/|$)|player-?int(?:\/|$))/i;
const wellKnownDir = join(publicDir, ".well-known");

function goneError() {
    const error = new Error("Gone");
    error.status = 410;
    return error;
}

export function registerStaticAssets(app) {
    app.use((req, res, next) => {
        if (!RETIRED_PUBLIC_PATH.test(req.path)) return next();
        return next(goneError());
    });

    app.use("/.well-known", express.static(wellKnownDir, {
        dotfiles: "deny",
        fallthrough: true
    }));
    app.use(express.static(publicDir));
}
