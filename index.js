
import express from "express";
import { readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const port = process.env.PORT || 3002;

// Set EJS as the view engine
app.set("view engine", "ejs");
app.set("views", join(__dirname, "views"));

// Serve static files from /public
app.use(express.static(join(__dirname, "public")));

// --- Auto-generate routes for all .ejs files ---
const viewsDir = join(__dirname, "views");
const viewFiles = readdirSync(viewsDir).filter(file => file.endsWith(".ejs"));

viewFiles.forEach(file => {
    const name = file.replace(".ejs", "");

    if (name === "index") {
        // homepage → "/"
        app.get("/", (req, res) => res.render(name));
    } else {
        // other pages → "/filename"
        app.get(`/${name}`, (req, res) => res.render(name));
    }
});

app.listen(port, () => {
    console.log(`Listening on port ${port}`);
});
