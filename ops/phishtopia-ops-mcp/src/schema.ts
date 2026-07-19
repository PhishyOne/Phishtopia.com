import { z } from "zod";

import {
  ACTION_NAMES,
  ALLOWED_SECRETS,
  MAX_OBSERVATIONS,
  MAX_OBSERVATION_VALUE_LENGTH,
} from "./constants.js";

export const NoArgsSchema = z.object({}).strict();

export const SecretNameSchema = z.enum(ALLOWED_SECRETS);
export const SecretMetadataInputSchema = z
  .object({ secret: SecretNameSchema })
  .strict();

const ObservationSchema = z
  .object({
    name: z
      .string()
      .regex(/^[a-z][a-z0-9_]*$/)
      .max(64),
    value: z.string().max(MAX_OBSERVATION_VALUE_LENGTH),
  })
  .strict();

export const ToolOutputSchema = z
  .object({
    status: z.enum(["ok", "degraded", "unavailable"]),
    checkedAt: z.string().datetime(),
    resource: z
      .string()
      .regex(/^[a-z][a-z0-9_-]*$/)
      .max(80),
    observations: z.array(ObservationSchema).max(MAX_OBSERVATIONS),
  })
  .strict();

export type ToolOutput = z.infer<typeof ToolOutputSchema>;
export type Observation = ToolOutput["observations"][number];

const CommitSchema = z.string().regex(/^[0-9a-f]{40}$/);
const DigestSchema = z.string().regex(/^[0-9a-f]{64}$/);
const IdempotencyKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,95}$/);

const UpgradeOpsReleaseSchema = z
  .object({
    type: z.literal("upgrade_ops_release"),
    commit: CommitSchema,
    artifactSha256: DigestSchema,
  })
  .strict();

const DeployVerifiedReleaseSchema = z
  .object({
    type: z.literal("deploy_verified_release"),
    commit: CommitSchema,
    artifactSha256: DigestSchema,
  })
  .strict();

const RestartServiceSchema = z
  .object({
    type: z.literal("restart_phishtopia_service"),
    service: z.enum(["phishtopia_app", "phishtopia_ops_tunnel"]),
  })
  .strict();

const RollbackReleaseSchema = z
  .object({
    type: z.literal("rollback_release"),
    target: z.enum(["phishtopia_app", "phishtopia_ops"]),
    release: CommitSchema,
  })
  .strict();

const CanarySchema = z
  .object({
    type: z.literal("canary_and_promote"),
    revision: z.string().regex(/^phishtopia-[0-9]{5}-[a-z0-9]{3}$/),
    percentages: z
      .array(
        z.union([
          z.literal(1),
          z.literal(5),
          z.literal(10),
          z.literal(25),
          z.literal(50),
          z.literal(100),
        ]),
      )
      .min(2)
      .max(6)
      .refine(
        (values) =>
          values.at(-1) === 100 &&
          values[0]! <= 10 &&
          values.every(
            (value, index) => index === 0 || value > values[index - 1]!,
          ),
        "percentages must begin at or below 10, strictly increase, and end at 100",
      ),
  })
  .strict();

const MigrationSchema = z
  .object({
    type: z.literal("run_tested_migration"),
    commit: CommitSchema,
    artifactSha256: DigestSchema,
    migrationId: z.string().regex(/^[0-9]{14}_[a-z][a-z0-9_]{0,47}$/),
  })
  .strict();

const RotateSessionSecretSchema = z
  .object({
    type: z.literal("rotate_session_secret"),
    secret: z.literal("phishtopia-session-secret"),
  })
  .strict();

const DnsBase = {
  type: z.literal("update_dns_with_rollback"),
  ttl: z.union([z.literal(60), z.literal(300), z.literal(3600)]),
};

const DnsSchema = z.discriminatedUnion("recordType", [
  z
    .object({
      ...DnsBase,
      hostname: z.literal("phishtopia.com"),
      recordType: z.literal("A"),
      value: z.literal("34.73.92.179"),
    })
    .strict(),
  z
    .object({
      ...DnsBase,
      hostname: z.literal("www.phishtopia.com"),
      recordType: z.literal("CNAME"),
      value: z.literal("phishtopia-ht3gdpkzmq-ue.a.run.app"),
    })
    .strict(),
]);

export const ActionSchema = z.union([
  UpgradeOpsReleaseSchema,
  DeployVerifiedReleaseSchema,
  RestartServiceSchema,
  RollbackReleaseSchema,
  CanarySchema,
  MigrationSchema,
  RotateSessionSecretSchema,
  DnsSchema,
]);

export const StartJobInputSchema = z
  .object({
    idempotencyKey: IdempotencyKeySchema,
    action: ActionSchema,
  })
  .strict();

export const JobIdInputSchema = z.object({ jobId: z.string().uuid() }).strict();

export const JobStateSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelling",
  "cancelled",
]);

export const JobOutputSchema = z
  .object({
    jobId: z.string().uuid(),
    action: z.enum(ACTION_NAMES),
    state: JobStateSchema,
    progress: z.number().int().min(0).max(100),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    deadlineAt: z.string().datetime(),
    resultCode: z
      .enum([
        "accepted",
        "in_progress",
        "completed",
        "cancel_requested",
        "cancelled_and_rolled_back",
        "failed_and_rolled_back",
        "rollback_failed",
        "preflight_rejected",
        "failed_without_mutation",
        "not_found",
      ])
      .optional(),
    observations: z.array(ObservationSchema).max(MAX_OBSERVATIONS),
  })
  .strict();

export type StartJobInput = z.infer<typeof StartJobInputSchema>;
export type JobOutput = z.infer<typeof JobOutputSchema>;
