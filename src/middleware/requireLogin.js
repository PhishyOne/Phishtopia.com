export function requireLogin(req, res, next) {
    if (req.session?.user) return next();

    const requestPath = typeof req.path === "string"
        ? req.path
        : req.originalUrl.split("?", 1)[0];
    const isApiRequest = requestPath.startsWith("/api/");

    if (req.method === "GET" && !isApiRequest) {
        req.session.returnTo = req.originalUrl;
        const encodedReturnTo = encodeURIComponent(req.originalUrl);
        return res.redirect(`/auth/login?returnTo=${encodedReturnTo}`);
    }

    return res.redirect("/auth/login");
}
