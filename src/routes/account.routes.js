import express from "express";
import rateLimit from "express-rate-limit";

import {
    changePassword,
    changeUsername,
    requestEmailChange,
    showAccount,
    verifyEmailChange
} from "../controllers/account.controller.js";
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

const verifyEmailChangeLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    handler: rateLimitHandler
});

router.get("/verify-email", verifyEmailChangeLimiter, verifyEmailChange);

router.use(requireLogin);
router.get("/", showAccount);
router.post("/username", accountUpdateLimiter, changeUsername);
router.post("/email", accountUpdateLimiter, requestEmailChange);
router.post("/password", passwordUpdateLimiter, changePassword);

export default router;
