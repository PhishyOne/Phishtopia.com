export function templateLocals(req, res, next) {
    const siteUrl = process.env.SITE_URL || "https://phishtopia.com";
    const canonicalPath = req.path === "/" ? "/" : req.path.replace(/\/$/, "");
    const canonicalUrl = new URL(canonicalPath, siteUrl).toString();

    res.locals.extraStyles = [];
    res.locals.extraScripts = [];
    res.locals.user = req.session?.user || null;
    res.locals.currentUrl = req.originalUrl;
    res.locals.canonicalUrl = canonicalUrl;

    if (process.env.LOG_SESSIONS === "true") {
        console.log("SESSION:", {
            user: req.session?.user || null,
            returnTo: req.session?.returnTo || null
        });
    }

    next();
}
