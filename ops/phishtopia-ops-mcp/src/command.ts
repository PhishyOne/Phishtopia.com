import { spawn } from "node:child_process";

export type CommandResult = {
  stdout: string;
  exitCode: number;
};

export interface CommandRunner {
  run(
    file: string,
    args: readonly string[],
    timeoutMs: number,
  ): Promise<CommandResult>;
}

/** A non-shell runner used only by fixed command builders in google.ts. */
export class ProcessRunner implements CommandRunner {
  async run(
    file: string,
    args: readonly string[],
    timeoutMs: number,
  ): Promise<CommandResult> {
    return await new Promise<CommandResult>((resolve, reject) => {
      const child = spawn(file, [...args], {
        shell: false,
        stdio: ["ignore", "pipe", "ignore"],
        env: {
          HOME: process.env.HOME ?? "",
          PATH: process.env.PATH ?? "",
          CLOUDSDK_CONFIG: process.env.CLOUDSDK_CONFIG ?? "",
          NO_COLOR: "1",
        },
      });
      let stdout = "";
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, timeoutMs);
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
        if (stdout.length > 262_144) child.kill("SIGTERM");
      });
      child.once("error", () => {
        clearTimeout(timer);
        reject(new Error("command_unavailable"));
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        if (timedOut)
          return reject(
            Object.assign(new Error("timeout"), { name: "AbortError" }),
          );
        if (code !== 0) return reject(new Error("command_failed"));
        resolve({ stdout, exitCode: code ?? 1 });
      });
    });
  }
}
