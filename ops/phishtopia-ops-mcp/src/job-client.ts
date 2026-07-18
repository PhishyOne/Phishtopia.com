import { createConnection } from "node:net";

import { JOB_SOCKET } from "./constants.js";
import {
  JobOutputSchema,
  type JobOutput,
  type StartJobInput,
} from "./schema.js";

type WorkerRequest =
  | { operation: "start_job"; payload: StartJobInput }
  | { operation: "get_job_status"; payload: { jobId: string } }
  | { operation: "cancel_job"; payload: { jobId: string } };

type JobExchange = (socketPath: string, encoded: string) => Promise<string>;

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
      if (response.length > 65_536)
        socket.destroy(new Error("response_too_large"));
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

export interface JobClient {
  start(input: StartJobInput): Promise<JobOutput>;
  status(jobId: string): Promise<JobOutput>;
  cancel(jobId: string): Promise<JobOutput>;
}

export class UnixJobClient implements JobClient {
  constructor(
    private readonly socketPath: string = JOB_SOCKET,
    private readonly exchange: JobExchange = exchangeSocket,
  ) {}

  start(input: StartJobInput): Promise<JobOutput> {
    return this.request({ operation: "start_job", payload: input });
  }

  status(jobId: string): Promise<JobOutput> {
    return this.request({ operation: "get_job_status", payload: { jobId } });
  }

  cancel(jobId: string): Promise<JobOutput> {
    return this.request({ operation: "cancel_job", payload: { jobId } });
  }

  private async request(value: WorkerRequest): Promise<JobOutput> {
    const encoded = `${JSON.stringify(value)}\n`;
    if (Buffer.byteLength(encoded) > 32_768)
      throw new Error("request_too_large");
    const response = await this.exchange(this.socketPath, encoded);
    try {
      const envelope = JSON.parse(response) as {
        ok?: unknown;
        job?: unknown;
      };
      if (envelope.ok !== true) throw new Error("worker_rejected");
      return JobOutputSchema.parse(envelope.job);
    } catch {
      throw new Error("invalid_worker_response");
    }
  }
}
