import { createConnection } from "node:net";

import { JOB_SOCKET } from "./constants.js";
import { ToolOutputSchema, type ToolOutput } from "./schema.js";

type WorkerExchange = (socketPath: string, encoded: string) => Promise<string>;

async function exchangeSocket(
  socketPath: string,
  encoded: string,
): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const socket = createConnection({ path: socketPath });
    let response = "";
    const timer = setTimeout(() => socket.destroy(new Error("timeout")), 5_000);
    socket.setEncoding("utf8");
    socket.once("connect", () => socket.end(encoded));
    socket.on("data", (chunk: string) => {
      response += chunk;
      if (response.length > 65_536) {
        socket.destroy(new Error("response_too_large"));
      }
    });
    socket.once("error", () => {
      clearTimeout(timer);
      reject(new Error("worker_unavailable"));
    });
    socket.once("end", () => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

export interface ReleaseStatusClient {
  getReleaseStatus(): Promise<ToolOutput>;
}

export class UnixReleaseStatusClient implements ReleaseStatusClient {
  constructor(
    private readonly socketPath: string = JOB_SOCKET,
    private readonly exchange: WorkerExchange = exchangeSocket,
  ) {}

  async getReleaseStatus(): Promise<ToolOutput> {
    const encoded = `${JSON.stringify({
      operation: "get_release_status",
      payload: {},
    })}\n`;
    const response = await this.exchange(this.socketPath, encoded);
    try {
      const envelope = JSON.parse(response) as {
        ok?: unknown;
        releaseStatus?: unknown;
      };
      if (envelope.ok !== true) throw new Error("worker_rejected");
      return ToolOutputSchema.parse(envelope.releaseStatus);
    } catch {
      throw new Error("invalid_worker_response");
    }
  }
}
