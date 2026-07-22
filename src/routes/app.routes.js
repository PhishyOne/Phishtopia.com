import express from "express";

import { socialShareCardPng } from "../assets/socialShareCard.js";
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

    router.get("/images/share-card.png", (req, res) => {
        res.set({
            "Cache-Control": "public, max-age=86400",
            "Content-Length": String(socialShareCardPng.length),
            "Content-Type": "image/png"
        });
        res.send(socialShareCardPng);
    });

    router.use("/auth", authRoutes);
    router.use("/internal/analytics", analyticsRoutes);

    for (const [routePath, featureRouter] of FEATURE_ROUTES.entries()) {
        router.use(routePath, featureRouter);
    }

    router.use(buildPagesRouter());

    return router;
}
