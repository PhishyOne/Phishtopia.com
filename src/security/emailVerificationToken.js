import crypto from "crypto";

export const EMAIL_VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

const TOKEN_BYTES = 32;
const CURRENT_TOKEN_PATTERN = /^v1\.([0-9a-z]+)\.([0-9a-f]{64})$/;
const LEGACY_TOKEN_PATTERN = /^[0-9a-f]{64}$/;

function resolveNow(now) {
    const value = Number(typeof now === "function" ? now() : now);
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new TypeError("Invalid verification-token clock");
    }
    return value;
}

export function createEmailVerificationToken({
    now = Date.now,
    randomBytes = crypto.randomBytes,
    ttlMs = EMAIL_VERIFICATION_TOKEN_TTL_MS
} = {}) {
    const issuedAt = resolveNow(now);
    const safeTtl = Number(ttlMs);
    if (!Number.isSafeInteger(safeTtl) || safeTtl <= 0) {
        throw new TypeError("Invalid verification-token TTL");
    }

    const expiresAt = issuedAt + safeTtl;
    if (!Number.isSafeInteger(expiresAt)) {
        throw new TypeError("Verification-token expiry overflow");
    }

    const entropy = randomBytes(TOKEN_BYTES);
    if (!Buffer.isBuffer(entropy) || entropy.length !== TOKEN_BYTES) {
        throw new TypeError("Invalid verification-token entropy");
    }

    return {
        token: `v1.${expiresAt.toString(36)}.${entropy.toString("hex")}`,
        expiresAt
    };
}

export function inspectEmailVerificationToken(token, { now = Date.now } = {}) {
    if (typeof token !== "string" || token.length > 128) {
        return { ok: false, reason: "invalid", status: 400 };
    }

    const normalized = token.trim();
    if (LEGACY_TOKEN_PATTERN.test(normalized)) {
        return {
            ok: true,
            legacy: true,
            expiresAt: null
        };
    }

    const match = CURRENT_TOKEN_PATTERN.exec(normalized);
    if (!match) {
        return { ok: false, reason: "invalid", status: 400 };
    }

    const expiresAt = Number.parseInt(match[1], 36);
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= 0) {
        return { ok: false, reason: "invalid", status: 400 };
    }

    if (expiresAt <= resolveNow(now)) {
        return {
            ok: false,
            reason: "expired",
            status: 410,
            expiresAt
        };
    }

    return {
        ok: true,
        legacy: false,
        expiresAt
    };
}
