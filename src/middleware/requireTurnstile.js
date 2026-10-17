import { verifyTurnstileToken } from '../services/turnstile.service.js';

export function requireTurnstile(expectedAction, verify = verifyTurnstileToken) {
    return async (req, res, next) => {
        let valid = false;
        try {
            valid = await verify({
                token: req.body?.['cf-turnstile-response'],
                expectedAction,
                remoteIp: req.ip
            });
        } catch {
            valid = false;
        }

        if (!valid) {
            return res.status(403).type('text/plain')
                .send('Verification failed. Reload the form and try again.');
        }
        return next();
    };
}
