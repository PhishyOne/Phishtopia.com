import { appendFileSync } from "fs";
import { extname, join } from "path";
import { logsDir } from "../config/paths.js";

const ASSET_EXTENSIONS = new Set([".css", ".js", ".png", ".jpg", ".jpeg", ".svg", ".webp", ".ico"]);
const seenClients = new Set();
const accessLogFile = join(logsDir, "unique_ips.log");

export function staticAssetLogger(req, res, next) {
    if (process.env.LOG_UNIQUE_STATIC_IPS !== "true") return next();

    const pathWithoutQuery = req.path || req.url;
    const isStatic = ASSET_EXTENSIONS.has(extname(pathWithoutQuery).toLowerCase());
    const client = req.ip || req.socket.remoteAddress;

    if (isStatic && !seenClients.has(client)) {
        seenClients.add(client);
        const msg = `[${new Date().toISOString()}] [UNIQUE CLIENT] ${client} requested ${req.url}\n`;
        appendFileSync(accessLogFile, msg);
        console.log(msg.trim());
    }

    next();
}
