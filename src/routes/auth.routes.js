import express from "express";
import rateLimit from "express-rate-limit";
import {
    login,
    logout,
    register,
    resendVerification,
    showLogin,
    showRegister,
    showResendVerification,
    verifyEmail
} from "../controllers/auth.controller.js";
import { rateLimitHandler } from "../middleware/errorResponses.js";

const router = express.Router();

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    handler: rateLimitHandler
});

const registerLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    handler: rateLimitHandler
});

const resendVerificationLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 3,
    standardHeaders: true,
    legacyHeaders: false,
    handler: rateLimitHandler
});

const verifyEmailLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    handler: rateLimitHandler
});

router.get("/register", showRegister);
router.post("/register", registerLimiter, register);
router.get("/login", showLogin);
router.post("/login", loginLimiter, login);
router.get("/verify-email", verifyEmailLimiter, verifyEmail);
router.get("/resend-verification", showResendVerification);
router.post("/resend-verification", resendVerificationLimiter, resendVerification);
router.post("/logout", logout);

export default router;
