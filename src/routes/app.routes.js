import express from "express";

import analyticsRoutes from "./analytics.routes.js";
import authRoutes from "./auth.routes.js";
import echoTraceRoutes from "./echotrace.routes.js";
import storecalcRoutes from "./storecalc.routes.js";
import youListRoutes from "./youlist.routes.js";
import { buildPagesRouter } from "./pages.routes.js";

const FEATURE_ROUTES = new Map([
    ["/echotrace", echoTraceRoutes],
    ["/youlist", youListRoutes],
    ["/storecalc", storecalcRoutes]
]);

export function buildAppRouter() {
    const router = express.Router();

    router.use("/auth", authRoutes);
    router.use("/internal/analytics", analyticsRoutes);

    for (const [routePath, featureRouter] of FEATURE_ROUTES.entries()) {
        router.use(routePath, featureRouter);
    }

    router.use(buildPagesRouter());

    return router;
}
