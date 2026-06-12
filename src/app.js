import express from "express";
import ejs from "ejs";
import { mkdirSync } from "fs";

import { logsDir, viewsDir } from "./config/paths.js";
import { buildSessionMiddleware } from "./config/session.js";
import { canonicalRedirects } from "./middleware/canonicalRedirects.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { registerStaticAssets } from "./middleware/staticAssets.js";
import { staticAssetLogger } from "./middleware/staticAssetLogger.js";
import { templateLocals } from "./middleware/templateLocals.js";
import { buildAppRouter } from "./routes/app.routes.js";

export function createApp() {
    mkdirSync(logsDir, { recursive: true });

    const app = express();
    app.disable("x-powered-by");
    app.set("trust proxy", 1);

    app.use(canonicalRedirects);
    app.use(express.urlencoded({ extended: true }));
    app.use(express.json());

    app.get("/health", (req, res) => {
        res.status(200).json({
            status: "ok",
            service: "phishtopia",
            timestamp: new Date().toISOString()
        });
    });

    app.use(buildSessionMiddleware());
    app.use(templateLocals);

    registerStaticAssets(app);
    app.use(staticAssetLogger);

    app.set("view engine", "ejs");
    app.set("views", viewsDir);
    app.engine("ejs", ejs.__express);
    app.locals.basedir = viewsDir;

    app.use(buildAppRouter());
    app.use(errorHandler);

    return app;
}
