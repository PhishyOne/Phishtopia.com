function defineErrorPage({ status, eyebrow, title, message, apiMessage, icon }) {
    return Object.freeze({ status, eyebrow, title, message, apiMessage, icon });
}

export const ERROR_PAGES = Object.freeze({
    403: defineErrorPage({
        status: 403,
        eyebrow: "Access forbidden",
        title: "These waters are restricted.",
        message: "You don’t have permission to pass beyond this point.",
        apiMessage: "Forbidden",
        icon: "lock"
    }),
    404: defineErrorPage({
        status: 404,
        eyebrow: "Page not found",
        title: "This page is off the map.",
        message: "Looks like you’ve drifted into uncharted waters.",
        apiMessage: "Not found",
        icon: "compass"
    }),
    429: defineErrorPage({
        status: 429,
        eyebrow: "Rate limit exceeded",
        title: "Too many requests.",
        message: "Slow down a bit. You’re causing a current.",
        apiMessage: "Too many requests",
        icon: "current"
    }),
    500: defineErrorPage({
        status: 500,
        eyebrow: "Internal server error",
        title: "Something stirred in the depths.",
        message: "An internal error surfaced while we were processing your request.",
        apiMessage: "Internal server error",
        icon: "engine"
    })
});

const GENERIC_ERROR_PAGE = defineErrorPage({
    status: 500,
    eyebrow: "Request failed",
    title: "Something went off course.",
    message: "The request could not be completed.",
    apiMessage: "Request failed",
    icon: "engine"
});

export function getErrorPage(status) {
    const numericStatus = Number(status);
    const knownPage = ERROR_PAGES[numericStatus];
    if (knownPage) return knownPage;

    if (Number.isInteger(numericStatus) && numericStatus >= 400 && numericStatus <= 599) {
        return Object.freeze({
            ...GENERIC_ERROR_PAGE,
            status: numericStatus
        });
    }

    return ERROR_PAGES[500];
}
