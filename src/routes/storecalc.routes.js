import express from "express";
import { showStoreCalcPage } from "../controllers/storecalc.controller.js";

const router = express.Router();

router.get("/", showStoreCalcPage);

export default router;