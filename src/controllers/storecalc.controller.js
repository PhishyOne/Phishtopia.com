import { pageLocals } from "../config/pageAssets.js";

export function showStoreCalcPage(req, res) {
    return res.render("storecalc/index", pageLocals("storecalc"));
}
