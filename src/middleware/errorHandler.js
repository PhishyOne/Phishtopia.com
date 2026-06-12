import { appendFileSync } from "fs";
import { join } from "path";
import { logsDir } from "../config/paths.js";

const errorLogFile = join(logsDir, "errors.log");

export function errorHandler(err, req, res, next) {
    const msg = `[${new Date().toISOString()}] [ERROR] ${req.method} ${req.url} - ${err.message}\n${err.stack}\n`;
    appendFileSync(errorLogFile, msg);
    console.error(msg.trim());
    res.status(500).send("Something went wrong!");
}
