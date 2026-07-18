import { MAX_OBSERVATIONS, MAX_OBSERVATION_VALUE_LENGTH } from "./constants.js";
import type { Observation, ToolOutput } from "./schema.js";

const REDACTION_RULES: Array<[RegExp, string]> = [
  [
    /(postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s"']+/gi,
    "[redacted-connection]",
  ],
  [
    /(?:authorization|api[_-]?key|token|password|cookie|session|credential)\s*[=:]\s*[^\s,;]+/gi,
    "[redacted]",
  ],
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]"],
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[redacted-ip]"],
  [/\b(?:[0-9a-f]{1,4}:){2,}[0-9a-f:]*\b/gi, "[redacted-ip]"],
  [/(?:user(?:name)?|principal)\s*[=:]\s*[^\s,;]+/gi, "[redacted-user]"],
  [/https?:\/\/[^\s"']+/gi, "[redacted-url]"],
];

export function redact(value: string): string {
  let result = value.replace(/[\u0000-\u001f\u007f]/g, " ");
  for (const [pattern, replacement] of REDACTION_RULES) {
    result = result.replace(pattern, replacement);
  }
  return result
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_OBSERVATION_VALUE_LENGTH);
}

export function classifyLog(value: unknown): string {
  const text = typeof value === "string" ? value.toLowerCase() : "";
  if (
    /invalid_password|password authentication failed|sqlstate.?28p01/.test(text)
  ) {
    return "database_authentication_failure";
  }
  if (/err_http_headers_sent|headers already sent/.test(text)) {
    return "duplicate_response_header_error";
  }
  if (/session/.test(text)) return "session_store_error";
  if (/database|postgres|sqlstate/.test(text)) return "database_error";
  if (/crash|uncaught|exception/.test(text)) return "application_exception";
  if (/\b5\d\d\b|status.?5/.test(text)) return "http_5xx";
  return "other_sanitized_error";
}

export function safeTimestamp(value: unknown): string {
  if (typeof value !== "string") return "unknown";
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? "unknown" : new Date(parsed).toISOString();
}

export function safeEnum(value: unknown, allowed: readonly string[]): string {
  return typeof value === "string" && allowed.includes(value)
    ? value
    : "unknown";
}

export function output(
  resource: string,
  status: ToolOutput["status"],
  observations: Observation[],
): ToolOutput {
  return {
    status,
    checkedAt: new Date().toISOString(),
    resource,
    observations: observations
      .slice(0, MAX_OBSERVATIONS)
      .map(({ name, value }) => ({ name, value: redact(value) })),
  };
}

export function safeErrorCode(error: unknown): string {
  if (error instanceof Error && error.name === "AbortError") return "timeout";
  return "read_only_operation_unavailable";
}
