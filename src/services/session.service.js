function callSessionMethod(req, methodName) {
    return new Promise((resolve, reject) => {
        const method = req.session?.[methodName];
        if (typeof method !== "function") {
            reject(new Error(`Session method unavailable: ${methodName}`));
            return;
        }

        method.call(req.session, error => {
            if (error) reject(error);
            else resolve();
        });
    });
}

export async function establishAuthenticatedSession(req, user) {
    await callSessionMethod(req, "regenerate");
    req.session.user = user;
    await callSessionMethod(req, "save");
}

export async function destroySession(req) {
    await callSessionMethod(req, "destroy");
}
