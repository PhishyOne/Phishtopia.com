import express from "express";
import bcrypt from "bcrypt";
import pool from "../db.js";

const router = express.Router();
const SALT_ROUNDS = 10;

// =====================
// Register a new user
// =====================
router.post("/register", async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, error: "Missing fields" });

    try {
        const hashed = await bcrypt.hash(password, SALT_ROUNDS);

        const result = await pool.query(
            "INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username",
            [username, hashed]
        );

        res.json({ success: true, user: result.rows[0] });
    } catch (err) {
        if (err.code === "23505") {
            // unique violation
            return res.status(409).json({ success: false, error: "Username already exists" });
        }
        console.error(err);
        res.status(500).json({ success: false, error: "Server error" });
    }
});

// =====================
// Login
// =====================
router.post("/login", async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, error: "Missing fields" });

    try {
        const result = await pool.query("SELECT * FROM users WHERE username = $1", [username]);
        const user = result.rows[0];
        if (!user) return res.status(401).json({ success: false, error: "Invalid credentials" });

        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) return res.status(401).json({ success: false, error: "Invalid credentials" });

        // Save user in session
        req.session.user = { id: user.id, username: user.username };
        res.json({ success: true, user: { id: user.id, username: user.username } });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: "Server error" });
    }
});

// =====================
// Logout
// =====================
router.post("/logout", (req, res) => {
    req.session.destroy(err => {
        if (err) return res.status(500).json({ success: false, error: "Logout failed" });
        res.clearCookie("sid"); // clear cookie set by express-session
        res.json({ success: true });
    });
});

//Helper Function to protect routes
export function requireLogin(req, res, next) {
    if (req.session?.user) return next();
    return res.status(401).send("You must be logged in to access this page");
}

export default router;
