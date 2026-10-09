const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const MAX_TOKEN_LENGTH = 2048;

/**
 * Redeem one Turnstile token before allowing an email-producing action.
 * A missing configuration, invalid verdict, or verification outage fails closed.
 */
export async function verifyTurnstileToken({
    token,
    expectedAction,
    remoteIp,
    secret = process.env.TURNSTILE_SECRET,
    allowedHostnames = process.env.TURNSTILE_HOSTNAMES,
    fetchImpl = globalThis.fetch
} = {}) {
    const hostnames = new Set(
        (typeof allowedHostnames === 'string' ? allowedHostnames : '')
            .split(',')
            .map(hostname => hostname.trim())
            .filter(Boolean)
    );

    if (
        typeof token !== 'string' ||
        token.length === 0 ||
        token.length > MAX_TOKEN_LENGTH ||
        typeof secret !== 'string' ||
        !secret.trim() ||
        typeof expectedAction !== 'string' ||
        !expectedAction ||
        hostnames.size === 0 ||
        (process.env.NODE_ENV === 'production' &&
            (hostnames.has('localhost') || hostnames.has('127.0.0.1')))
    ) {
        return false;
    }

    const body = new URLSearchParams({ secret, response: token });
    if (typeof remoteIp === 'string' && remoteIp) {
        body.set('remoteip', remoteIp);
    }

    try {
        const response = await fetchImpl(SITEVERIFY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body,
            signal: AbortSignal.timeout(10_000)
        });
        if (!response.ok) return false;

        const result = await response.json();
        return result?.success === true &&
            result.action === expectedAction &&
            hostnames.has(result.hostname);
    } catch {
        // Do not leak tokens, secrets, or Siteverify responses into logs.
        return false;
    }
}
