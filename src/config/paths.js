import { dirname, join } from "path";
import { fileURLToPath } from "url";

export const srcDir = dirname(fileURLToPath(import.meta.url));
export const rootDir = dirname(dirname(srcDir));
export const viewsDir = join(rootDir, "views");
export const publicDir = join(rootDir, "public");
export const logsDir = join(rootDir, "logs");
export const projectAssetsDir = join(rootDir, "public", "projects");
