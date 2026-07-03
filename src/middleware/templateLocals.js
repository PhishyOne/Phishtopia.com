function buildCanonicalUrl(req) {
    const siteUrl = process.env.SITE_URL || "https://phishtopia.com";
    const cleanBaseUrl = siteUrl.replace(/\/$/, "");

    const pathOnly = req.path === "/" ? "/" : req.path.replace(/\/$/, "");

    return `${cleanBaseUrl}${pathOnly}`;
}

export function templateLocals(req, res, next) {
    res.locals.extraStyles = [];
    res.locals.extraScripts = [];
    res.locals.user = req.session?.user || null;
    res.locals.currentUrl = req.originalUrl;
    res.locals.canonicalUrl = buildCanonicalUrl(req);

    if (process.env.LOG_SESSIONS === "true") {
        console.log("SESSION:", {
            user: req.session?.user || null,
            returnTo: req.session?.returnTo || null
        });
    }

    next();
}
