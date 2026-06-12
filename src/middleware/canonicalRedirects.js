const LEGACY_REDIRECTS = new Map([
    ["/home", "/"],
    ["/playerint", "/player-int"],
    ["/static/8-agency", "/projects"],
    ["/static/8-agency/", "/projects"]
]);

function absoluteCanonicalUrl(path) {
    return `https://phishtopia.com${path}`;
}

export function canonicalRedirects(req, res, next) {
    if (req.hostname === "www.phishtopia.com") {
        return res.redirect(301, absoluteCanonicalUrl(req.originalUrl));
    }

    const normalizedPath = req.path.toLowerCase();

    if (LEGACY_REDIRECTS.has(normalizedPath)) {
        return res.redirect(301, absoluteCanonicalUrl(LEGACY_REDIRECTS.get(normalizedPath)));
    }

    if (req.path === "/" && ["SA", "SD"].some(param => Object.hasOwn(req.query, param))) {
        return res.redirect(301, absoluteCanonicalUrl("/"));
    }

    return next();
}
