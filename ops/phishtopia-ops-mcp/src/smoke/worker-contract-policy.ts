export type WorkerContractOperation = "get_contract" | "get_runtime_preflight";

export const WORKER_REQUEST_TIMEOUT_MS: Readonly<
  Record<WorkerContractOperation, number>
> = Object.freeze({
  get_contract: 15_000,
  get_runtime_preflight: 120_000,
});
