// HINTS:
// 1. Import express and axios
import express from "express";
import axios from "axios";
const router = express.Router();

// 2. When the user goes to the home page it should render the index.ejs file.
router.get("/", async (req, res) => {
    try {
        const response = await axios.get("https://secrets-api.appbrewery.com/random");
        const secret = response.data.secret;
        const user = response.data.username;
        res.render("project28/index", { secret, user });
    } catch (error) {
        res.render("project28/index", { secret: "Error fetching secret", user: "" });
    }
});

export default router;