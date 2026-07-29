import express from "express";
import { publicDir } from "../config/paths.js";

const RETIRED_PUBLIC_PATH = /^\/(?:static(?:\/|$)|projects(?:\/|$)|project(?:25|28|29|30|33-1|33-2|33-3|34)(?:\/|$)|player-?int(?:\/|$))/i;

function notFoundError() {
    const error = new Error("Not Found");
    error.status = 404;
    return error;
}

export function registerStaticAssets(app) {
    app.use((req, res, next) => {
        if (!RETIRED_PUBLIC_PATH.test(req.path)) return next();
        return next(notFoundError());
    });

    app.use(express.static(publicDir));
}
