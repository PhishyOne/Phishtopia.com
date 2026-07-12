const DEFAULT_SITE_URL = "https://phishtopia.com";

function siteOrigin() {
    try {
        return new URL(process.env.SITE_URL || DEFAULT_SITE_URL).origin;
    } catch {
        return new URL(DEFAULT_SITE_URL).origin;
    }
}

function safePathFromUrl(url) {
    const path = `${url.pathname}${url.search}${url.hash}`;
    return path.startsWith("/") ? path : null;
}

export function safeInternalRedirect(value, fallback = "/") {
    if (typeof value !== "string") return fallback;

    const candidate = value.trim();
    if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//")) {
        return fallback;
    }

    let decoded;
    try {
        decoded = decodeURIComponent(candidate);
    } catch {
        return fallback;
    }

    if (decoded.includes("\\") || decoded.startsWith("//")) {
        return fallback;
    }

    try {
        const base = new URL(DEFAULT_SITE_URL);
        const url = new URL(candidate, base);
        if (url.origin !== base.origin) return fallback;
        return safePathFromUrl(url) || fallback;
    } catch {
        return fallback;
    }
}

export function safeSameSiteReferer(value, fallback = "/") {
    if (typeof value !== "string" || !value.trim()) return fallback;

    try {
        const url = new URL(value);
        if (url.origin !== siteOrigin()) return fallback;
        return safePathFromUrl(url) || fallback;
    } catch {
        return safeInternalRedirect(value, fallback);
    }
}
