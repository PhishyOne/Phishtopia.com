import express from "express";
import bcrypt from "bcrypt";
import pool from "../db.js";

const router = express.Router();
const SALT_ROUNDS = 10;

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

// =====================
// POST /register
// =====================
router.post("/register", async (req, res) => {
    const { username, password, email } = req.body;

    if (!username || !password || !email) {
        return res.render("register", {
            title: "Register",
            bodyClass: "register",
            error: "All fields are required",
            username,
            password: ""
        });
    }

    try {
        const hashed = await bcrypt.hash(password, SALT_ROUNDS);
        const result = await pool.query(
            "INSERT INTO users (username, password_hash, email) VALUES ($1, $2, $3) RETURNING id, username",
            [username, hashed, email]
        );

        req.session.user = result.rows[0];

        // Redirect to saved returnTo or home
        const redirectTo = req.session.returnTo || "/";
        delete req.session.returnTo;
        res.redirect(redirectTo);

    } catch (err) {
        if (err.code === "23505") {
            return res.render("register", {
                title: "Register",
                bodyClass: "register",
                error: "Username already exists",
                username,
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
router.post("/login", async (req, res) => {
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

        req.session.user = { id: user.id, username: user.username };

        // Redirect to saved returnTo or home
        const redirectTo = req.session.returnTo || "/";
        delete req.session.returnTo;
        res.redirect(redirectTo);

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