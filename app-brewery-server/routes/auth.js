import express from "express";
import bcrypt from "bcrypt";
import pool from "../db.js";
import rateLimit from "express-rate-limit";
import crypto from "crypto";
import nodemailer from "nodemailer";



const router = express.Router();
const SALT_ROUNDS = 10;
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // limit each IP to 10 requests
    message: "Too many login attempts. Try again later."
});
const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com", // or your SMTP provider
    port: 465,
    secure: true,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// =====================
// GET /register
// =====================
router.get("/register", (req, res) => {
    res.render("register", {
        title: "Register",
        bodyClass: "register",
        extraStyles: [],
        extraScripts: [],
        error: null,
        username: "",
        email: "",
        password: ""
    });
});

// =====================
// GET /login
// =====================
router.get("/login", (req, res) => {
    if (req.query.returnTo) {
        req.session.returnTo = req.query.returnTo;
    }
    res.render("login", {
        title: "Login",
        bodyClass: "auth",
        extraStyles: [],
        extraScripts: [],
        error: null,
        username: "",
        password: ""
    });
});

router.get("/verify-email", async (req, res) => {
    const { token } = req.query;
    if (!token) return res.send("Invalid token");

    try {
        const result = await pool.query(
            "UPDATE users SET email_verified = true, verify_token = NULL WHERE verify_token = $1 RETURNING username",
            [token]
        );

        if (!result.rows.length) return res.send("Token invalid or expired");

        res.send("Email verified! You can now log in.");
    } catch (err) {
        console.error(err);
        res.status(500).send("Server error");
    }
});

// =====================
// POST /register
// =====================
router.post("/register", async (req, res) => {
    const verificationToken = crypto.randomBytes(32).toString("hex");
    const { username, password, confirm_password, email } = req.body;

    if (!username || !password || !confirm_password || !email) {
        return res.render("register", {
            title: "Register",
            bodyClass: "register",
            extraStyles: [],
            extraScripts: [],
            error: "All fields are required",
            username,
            email,
            password: ""
        });
    }

    if (password !== confirm_password) {
        return res.render("register", {
            title: "Register",
            bodyClass: "register",
            error: "Passwords do not match",
            username,
            email,
            password: ""
        });
    }

    if (password.length < 8) {
        return res.render("register", {
            title: "Register",
            bodyClass: "register",
            error: "Password must be at least 8 characters",
            username,
            email,
            password: ""
        });
    }

    try {
        const hashed = await bcrypt.hash(password, SALT_ROUNDS);
        const result = await pool.query(
            "INSERT INTO users (username, password_hash, email, verify_token) VALUES ($1, $2, $3, $4) RETURNING id, username",
            [username, hashed, email, verificationToken]
        );
        const verifyUrl = `https://phishtopia.com/auth/verify-email?token=${verificationToken}`;

        await transporter.sendMail({
            from: `"Phishtopia" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: "Verify your email",
            html: `<p>Click the link to verify your email:</p><a href="${verifyUrl}">${verifyUrl}</a>`
        });
        res.render("check-email", { email });

        // Redirect to saved returnTo or home
        const redirectTo = req.session.returnTo || "/";
        delete req.session.returnTo;
        res.redirect(redirectTo);

    } catch (err) {
        if (err.code === "23505") {
            let message = "Already exists";

            if (err.constraint.includes("username")) {
                message = "Username already exists";
            } else if (err.constraint.includes("email")) {
                message = "Email already exists";
            }

            return res.render("register", {
                title: "Register",
                bodyClass: "register",
                error: message,
                username,
                email,
                password: ""
            });
        }
        console.error(err);
        res.status(500).send("Server error");
    }
});

// =====================
// POST /login
// =====================
router.post("/login", loginLimiter, async (req, res) => {
    const { username, password } = req.body;
    console.log("Login attempt:", req.body);
    try {
        const result = await pool.query(
            "SELECT * FROM users WHERE username = $1",
            [username]
        );
        const user = result.rows[0];

        if (!user || !(await bcrypt.compare(password, user.password_hash))) {
            return res.render("login", {
                title: "Login",
                bodyClass: "auth",
                error: "Invalid credentials",
                username,
                password: ""
            });
        }
        if (!user.email_verified) {
            return res.render("login", {
                title: "Login",
                bodyClass: "auth",
                error: "Please verify your email first",
                username,
                password: ""
            });
        }
        req.session.user = { id: user.id, username: user.username };

    } catch (err) {
        console.error(err);
        res.status(500).send("Server error");
    }
});

// =====================
// POST /logout
// =====================
router.post("/logout", (req, res) => {
    const referer = req.get("Referer");

    req.session.destroy(err => {
        if (err) return res.status(500).send("Logout failed");
        res.clearCookie("sid");
        res.redirect(referer || "/");
    });
});

// =====================
// Helper: protect routes
// =====================
export function requireLogin(req, res, next) {
    if (req.session?.user) return next();

    // Only save GET requests that are not API calls
    if (req.method === "GET" && !req.originalUrl.startsWith("/api/")) {
        req.session.returnTo = req.originalUrl; // remember the page they wanted
    }

    return res.redirect("/auth/login");
}

export default router;