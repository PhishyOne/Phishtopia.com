import express from "express";
import { readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

import playIntRouter from "./routes/playint.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const port = process.env.PORT || 3002;

// Set up EJS
app.set("view engine", "ejs");
app.set("views", join(__dirname, "views"));

// Static files (like /public/res/, /public/styles/, etc.)
app.use(express.static(join(__dirname, "public")));

// --- Auto-generate simple .ejs routes (except PlayInt) ---
const viewsDir = join(__dirname, "views");
const viewFiles = readdirSync(viewsDir)
    .filter(file => file.endsWith(".ejs") && file !== "PlayInt.ejs");

viewFiles.forEach(file => {
    const name = file.replace(".ejs", "");
    if (name === "index") {
        app.get("/", (req, res) => res.render(name));
    } else {
        app.get(`/${name}`, (req, res) => res.render(name));
    }
});

// --- Mount PlayInt route ---
app.use("/PlayInt", playIntRouter);

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
