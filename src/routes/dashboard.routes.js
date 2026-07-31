import express from "express";

import { showDashboard } from "../controllers/dashboard.controller.js";
import { requireLogin } from "../middleware/requireLogin.js";

const router = express.Router();

router.use(requireLogin);
router.get("/", showDashboard);

export default router;
