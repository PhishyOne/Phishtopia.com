export function templateLocals(req, res, next) {
    res.locals.extraStyles = [];
    res.locals.extraScripts = [];
    res.locals.user = req.session?.user || null;
    res.locals.currentUrl = req.originalUrl;

    if (process.env.LOG_SESSIONS === "true") {
        console.log("SESSION:", {
            user: req.session?.user || null,
            returnTo: req.session?.returnTo || null
        });
    }

    next();
}
