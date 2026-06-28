import express from "express";

import echoTraceRoutes from "../../routes/echotrace.js";
import project25Routes from "../../app-brewery-server/routes/project25.js";
import project28Routes from "../../app-brewery-server/routes/project28.js";
import project29Routes from "../../app-brewery-server/routes/project29.js";
import project30Routes from "../../app-brewery-server/routes/project30.js";
import project331Routes from "../../app-brewery-server/routes/project33-1.js";
import project332Routes from "../../app-brewery-server/routes/project33-2.js";
import project333Routes from "../../app-brewery-server/routes/project33-3.js";

const LEGACY_ROUTES = new Map([
    ["/player-int", echoTraceRoutes],
    ["/echotrace", echoTraceRoutes],
    ["/project25", project25Routes],
    ["/project28", project28Routes],
    ["/project29", project29Routes],
    ["/project30", project30Routes],
    ["/project33-1", project331Routes],
    ["/project33-2", project332Routes],
    ["/project33-3", project333Routes]
]);

export function buildLegacyRouter() {
    const router = express.Router();

    for (const [routePath, legacyRouter] of LEGACY_ROUTES.entries()) {
        router.use(routePath, legacyRouter);
    }

    return router;
}
