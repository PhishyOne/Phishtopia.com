import { appendFileSync } from "fs";
import { join } from "path";

import { logsDir } from "../config/paths.js";
import { sendErrorResponse } from "./errorResponses.js";

const errorLogFile = join(logsDir, "errors.log");

function statusFromError(error) {
    const candidate = Number(error?.status ?? error?.statusCode);
    if (Number.isInteger(candidate) && candidate >= 400 && candidate <= 599) {
        return candidate;
    }
    return 500;
}

function logServerError(error, req) {
    const detail = error?.stack || error?.message || String(error);
    const message = `[${new Date().toISOString()}] [ERROR] ${req.method} ${req.originalUrl || req.url} - ${detail}\n`;

    try {
        appendFileSync(errorLogFile, message);
    } catch (logError) {
        console.error("Failed to write application error log:", logError);
    }

    console.error(message.trim());
}

export function errorHandler(error, req, res, next) {
    if (res.headersSent) return next(error);

    const status = statusFromError(error);
    if (status >= 500) logServerError(error, req);

    return sendErrorResponse(req, res, status);
}
