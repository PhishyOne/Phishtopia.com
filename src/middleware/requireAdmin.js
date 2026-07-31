export function requireAdmin(req, res, next) {
    const user = req.session?.user;

    if (!user) {
        if (req.method === "GET") {
            req.session.returnTo = req.originalUrl;
            const encodedReturnTo = encodeURIComponent(req.originalUrl);
            return res.redirect(`/auth/login?returnTo=${encodedReturnTo}`);
        }

        return res.redirect("/auth/login");
    }

    if (user.role !== "admin") {
        return res.status(403).type("text/plain").send("Forbidden");
    }

    return next();
}
