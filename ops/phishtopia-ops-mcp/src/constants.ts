export const PROJECT_ID = "project-43a8be4b-69a7-4d52-805" as const;
export const REGION = "us-east1" as const;
export const ZONE = "us-east1-b" as const;
export const VM_NAME = "phishtopia-vm" as const;
export const SERVICE_NAME = "phishtopia" as const;
export const BACKUP_BUCKET =
  "project-43a8be4b-69a7-4d52-805-phishtopia-backups" as const;
export const PUBLIC_HEALTH_URL = "https://phishtopia.com/health" as const;
export const BUILD_ID = "3c80fe8e-9ec0-4276-b086-c0feb1998345" as const;

export const CLOUDFLARE_DNS_SECRET = "phishtopia-cloudflare-dns-token" as const;
export const CLOUDFLARE_ZONE = "phishtopia.com" as const;
export const CLOUDFLARE_ROOT_A = "34.73.92.179" as const;
export const CLOUDFLARE_WWW_CNAME =
  "phishtopia-ht3gdpkzmq-ue.a.run.app" as const;

export const ALLOWED_SECRETS = [
  "phishtopia-session-secret",
  "phishtopia-database-url",
] as const;

export const TOOL_NAMES = [
  "get_production_summary",
  "get_public_health",
  "get_vm_status",
  "get_backup_status",
  "get_monitoring_status",
  "get_cloud_run_status",
  "get_recent_sanitized_errors",
  "get_build_status",
  "get_secret_metadata",
  "get_cloudflare_dns_status",
  "start_job",
  "get_job_status",
  "cancel_job",
] as const;

export const ACTION_NAMES = [
  "upgrade_ops_release",
  "deploy_verified_release",
  "restart_phishtopia_service",
  "rollback_release",
  "canary_and_promote",
  "run_tested_migration",
  "rotate_session_secret",
  "update_dns_with_rollback",
] as const;

export const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
} as const;

export const MUTATING_JOB_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export const JOB_SOCKET = "/run/phishtopia-ops-worker/worker.sock" as const;

export const MAX_OBSERVATIONS = 12;
export const MAX_OBSERVATION_VALUE_LENGTH = 160;
export const MAX_LOG_ENTRIES = 10;
export const LOG_FRESHNESS = "6h";
