import express from "express";
import db from "../db.js";

const router = express.Router();

router.get("/", async (req, res) => {
    try {
        res.render("project34", {
            bodyClass: "project34",
            extraStyles: ["/project34/styles/main.css"],
            extraScripts: ["/js/canvas.js"],
        });
    } catch (err) {
        console.error("DB error:", err);
        res.status(500).send("Database error");
    }
});

export default router;