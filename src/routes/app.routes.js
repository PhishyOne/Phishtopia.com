import express from "express";

import authRoutes from "../../app-brewery-server/routes/auth.js";
import echoTraceRoutes from "../../routes/echotrace.js";
import project25Routes from "../../app-brewery-server/routes/project25.js";
import project28Routes from "../../app-brewery-server/routes/project28.js";
import project29Routes from "../../app-brewery-server/routes/project29.js";
import project30Routes from "../../app-brewery-server/routes/project30.js";
import project331Routes from "../../app-brewery-server/routes/project33-1.js";
import project332Routes from "../../app-brewery-server/routes/project33-2.js";
import project333Routes from "../../app-brewery-server/routes/project33-3.js";
import youListRoutes from "../../app-brewery-server/routes/project34.js";

import { buildPagesRouter } from "./pages.routes.js";

const FEATURE_ROUTES = new Map([
    ["/player-int", echoTraceRoutes],
    ["/echotrace", echoTraceRoutes],
    ["/project25", project25Routes],
    ["/project28", project28Routes],
    ["/project29", project29Routes],
    ["/project30", project30Routes],
    ["/project33-1", project331Routes],
    ["/project33-2", project332Routes],
    ["/project33-3", project333Routes],
    ["/youlist", youListRoutes]
]);

export function buildAppRouter() {
    const router = express.Router();

    router.use("/auth", authRoutes);

    for (const [routePath, featureRouter] of FEATURE_ROUTES.entries()) {
        router.use(routePath, featureRouter);
    }

    router.use(buildPagesRouter());

    return router;
}
