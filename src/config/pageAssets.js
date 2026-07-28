function definePage({ title, bodyClass, styles = [], scripts = [] }) {
    return Object.freeze({
        title,
        bodyClass,
        styles: Object.freeze([...styles]),
        scripts: Object.freeze([...scripts])
    });
}

export const PAGE_DEFINITIONS = Object.freeze({
    home: definePage({
        title: "Phishtopia",
        bodyClass: "home-page",
        scripts: ["/js/canvas.js"]
    }),
    contact: definePage({
        title: "Contact Me",
        bodyClass: "contact"
    }),
    archive: definePage({
        title: "Course Project Archive",
        bodyClass: "archive-page",
        styles: ["/styles/archive.css"],
        scripts: ["/js/canvas.js"]
    }),
    login: definePage({
        title: "Login",
        bodyClass: "auth",
        scripts: ["/js/auth.js"]
    }),
    register: definePage({
        title: "Register",
        bodyClass: "register",
        scripts: ["/js/register.js", "/js/auth.js"]
    }),
    resendVerification: definePage({
        title: "Resend verification email",
        bodyClass: "auth"
    }),
    checkEmail: definePage({
        title: "Check your email",
        bodyClass: "auth"
    }),
    youlist: definePage({
        title: "YouList - Movies",
        bodyClass: "youlist",
        styles: ["/styles/youlist.css", "/styles/youlist-mobile.css"],
        scripts: ["/js/canvas.js", "/js/youlist.js"]
    }),
    echotrace: definePage({
        title: "EchoTrace",
        bodyClass: "player-int",
        styles: ["/styles/echotrace.css"],
        scripts: ["/js/echotrace-logo.js", "/js/echotrace.js"]
    }),
    storecalc: definePage({
        title: "StoreCalc Online",
        bodyClass: "storecalc"
    })
});

export function pageLocals(pageName, values = {}) {
    const page = PAGE_DEFINITIONS[pageName];
    if (!page) throw new Error(`Unknown page definition: ${pageName}`);

    return {
        ...values,
        title: page.title,
        bodyClass: page.bodyClass,
        extraStyles: [...page.styles],
        extraScripts: [...page.scripts]
    };
}
