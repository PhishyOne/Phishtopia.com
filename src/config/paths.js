import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { tmpdir } from "os";

export const srcDir = dirname(fileURLToPath(import.meta.url));
export const rootDir = dirname(dirname(srcDir));
export const viewsDir = join(rootDir, "views");
export const publicDir = join(rootDir, "public");
export const logsDir =
  process.env.NODE_ENV === "production"
    ? "/var/log/phishtopia"
    : process.env.NODE_ENV === "test"
      ? join(tmpdir(), "phishtopia-test-logs")
      : join(rootDir, "logs");
export const projectAssetsDir = join(rootDir, "public", "projects");
