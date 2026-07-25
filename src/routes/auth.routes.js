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

const router = express.Router();

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: "Too many login attempts. Try again later."
});

const registerLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: "Too many registration attempts. Try again later."
});

const resendVerificationLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 3,
    standardHeaders: true,
    legacyHeaders: false,
    message: "Too many verification email requests. Try again later."
});

const verifyEmailLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: "Too many verification attempts. Try again later."
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
