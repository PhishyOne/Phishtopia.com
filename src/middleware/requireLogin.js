export function requireLogin(req, res, next) {
    if (req.session?.user) return next();

    if (req.method === "GET" && !req.originalUrl.startsWith("/api/")) {
        req.session.returnTo = req.originalUrl;
    }

    return res.redirect("/auth/login");
}
