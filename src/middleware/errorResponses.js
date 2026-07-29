import { getErrorPage } from "../config/errorPages.js";
import { pageLocals } from "../config/pageAssets.js";

const API_PATH_PATTERN = /^\/(?:api(?:\/|$)|internal(?:\/|$)|[^/]+\/api(?:\/|$))/i;
const STATIC_ASSET_PATTERN = /\.(?:css|js|mjs|map|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|otf|mp3|wav|ogg|json|txt)$/i;

function canonicalUrlForRequest(req, res) {
    if (typeof res.locals?.canonicalUrl === "string" && res.locals.canonicalUrl) {
        return res.locals.canonicalUrl;
    }

    const siteUrl = process.env.SITE_URL || "https://phishtopia.com";
    const requestPath = req.path === "/" ? "/" : (req.path || "/").replace(/\/$/, "");

    try {
        return new URL(requestPath || "/", siteUrl).toString();
    } catch {
        return new URL("/", siteUrl).toString();
    }
}

export function isApiRequest(req) {
    if (API_PATH_PATTERN.test(req.path || "")) return true;
    return req.accepts(["html", "json"]) === "json";
}

function isStaticAssetRequest(req) {
    return req.method === "GET" && STATIC_ASSET_PATTERN.test(req.path || "");
}

function errorLocals(req, res, errorPage) {
    return {
        ...pageLocals("error", { errorPage }),
        user: res.locals?.user ?? req.session?.user ?? null,
        currentUrl: res.locals?.currentUrl ?? req.originalUrl ?? "/",
        canonicalUrl: canonicalUrlForRequest(req, res)
    };
}

function applyErrorHeaders(res) {
    res.set("Cache-Control", "no-store");
    res.set("X-Robots-Tag", "noindex, nofollow");
}

function renderHtmlError(req, res, errorPage) {
    res.render("errors/error", errorLocals(req, res, errorPage), (renderError, html) => {
        if (renderError) {
            console.error("Failed to render branded error page:", renderError);
            if (!res.headersSent) {
                res.type("text/plain").send(errorPage.apiMessage);
            }
            return;
        }

        res.type("html").send(html);
    });
}

export function sendErrorResponse(req, res, status) {
    const errorPage = getErrorPage(status);

    res.status(errorPage.status);
    applyErrorHeaders(res);

    if (isApiRequest(req)) {
        return res.json({
            success: false,
            status: errorPage.status,
            error: errorPage.apiMessage
        });
    }

    if (isStaticAssetRequest(req)) {
        return res.type("text/plain").send(errorPage.apiMessage);
    }

    return renderHtmlError(req, res, errorPage);
}

export function rateLimitHandler(req, res) {
    return sendErrorResponse(req, res, 429);
}
