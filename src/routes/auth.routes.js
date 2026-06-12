import express from "express";
import rateLimit from "express-rate-limit";
import {
    login,
    logout,
    register,
    showLogin,
    showRegister,
    verifyEmail
} from "../controllers/auth.controller.js";

const router = express.Router();

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: "Too many login attempts. Try again later."
});

router.get("/register", showRegister);
router.post("/register", register);
router.get("/login", showLogin);
router.post("/login", loginLimiter, login);
router.get("/verify-email", verifyEmail);
router.post("/logout", logout);

export default router;
