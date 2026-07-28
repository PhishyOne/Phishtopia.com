import express from "express";
import { publicDir } from "../config/paths.js";

const RETIRED_PUBLIC_PATH = /^\/(?:
    static(?:\/|$)
    |projects(?:\/|$)
    |project(?:25|28|29|30|33-1|33-2|33-3|34)(?:\/|$)
    |player-?int(?:\/|$)
)/ix;

export function registerStaticAssets(app) {
    app.use((req, res, next) => {
        if (!RETIRED_PUBLIC_PATH.test(req.path)) return next();
        return res.status(404).type("text/plain").send("Not Found");
    });

    app.use(express.static(publicDir));
}
