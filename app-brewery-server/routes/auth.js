import express from "express";
import bcrypt from "bcrypt";
import pool from "../db.js";

const router = express.Router();
const SALT_ROUNDS = 10;

// Routes for rendering pages
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

router.get("/login", (req, res) => {
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
// Register a new user
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

        res.redirect("/dashboard"); 

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
// Login
// =====================
router.post("/login", async (req, res) => {
    const { username, password } = req.body;

    try {
        const result = await pool.query(
            "SELECT * FROM users WHERE username = $1",
            [username]
        );

        const user = result.rows[0];
        if (!user) {
            return res.render("login", {
                title: "Login",
                bodyClass: "auth",
                error: "Invalid credentials",
                username,
                password: ""
            });
        }

        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) {
            return res.render("login", {
                title: "Login",
                bodyClass: "auth",
                error: "Invalid credentials",
                username,
                password: ""
            });
        }

        req.session.user = { id: user.id, username: user.username };

        res.redirect("/dashboard"); 

    } catch (err) {
        console.error(err);
        res.status(500).send("Server error");
    }
});

// =====================
// Logout
// =====================
router.post("/logout", (req, res) => {
    req.session.destroy(err => {
        if (err) return res.status(500).send("Logout failed");

        res.clearCookie("sid");
        res.redirect("/"); 
    });
});


//Helper Function to protect routes
export function requireLogin(req, res, next) {
    if (req.session?.user) return next();
    return res.status(401).send("You must be logged in to access this page");
}

export default router;
