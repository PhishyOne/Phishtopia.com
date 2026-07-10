import express from "express";

import analyticsRoutes from "./analytics.routes.js";
import authRoutes from "./auth.routes.js";
import youListRoutes from "./youlist.routes.js";
import storecalcRoutes from "./storecalc.routes.js";

import { buildLegacyRouter } from "./legacy.routes.js";
import { buildPagesRouter } from "./pages.routes.js";

const FEATURE_ROUTES = new Map([
    ["/youlist", youListRoutes],
    ["/storecalc", storecalcRoutes]
]);

export function buildAppRouter() {
    const router = express.Router();

    router.use("/auth", authRoutes);
    router.use("/internal/analytics", analyticsRoutes);
    router.use(buildLegacyRouter());

    for (const [routePath, featureRouter] of FEATURE_ROUTES.entries()) {
        router.use(routePath, featureRouter);
    }

    router.use(buildPagesRouter());

    return router;
}
