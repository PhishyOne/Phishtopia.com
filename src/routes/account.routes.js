import express from "express";
import rateLimit from "express-rate-limit";

import {
    changePassword,
    changeUsername,
    deleteAccount,
    requestEmailChange,
    showAccount,
    showAccountDeleted,
    verifyEmailChange
} from "../controllers/account.controller.js";
import {
    provideCsrfToken,
    requireFormCsrfToken
} from "../middleware/csrf.js";
import { rateLimitHandler } from "../middleware/errorResponses.js";
import { requireLogin } from "../middleware/requireLogin.js";

const router = express.Router();

const accountUpdateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    handler: rateLimitHandler
});

const passwordUpdateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    handler: rateLimitHandler
});

const accountDeletionLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 3,
    standardHeaders: true,
    legacyHeaders: false,
    handler: rateLimitHandler
});

const verifyEmailChangeLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    handler: rateLimitHandler
});

router.get("/verify-email", verifyEmailChangeLimiter, verifyEmailChange);
router.get("/deleted", showAccountDeleted);

router.use(requireLogin, provideCsrfToken);
router.get("/", showAccount);
router.post("/username", accountUpdateLimiter, requireFormCsrfToken, changeUsername);
router.post("/email", accountUpdateLimiter, requireFormCsrfToken, requestEmailChange);
router.post("/password", passwordUpdateLimiter, requireFormCsrfToken, changePassword);
router.post("/delete", accountDeletionLimiter, requireFormCsrfToken, deleteAccount);

export default router;
