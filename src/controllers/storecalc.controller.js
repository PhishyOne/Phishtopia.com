import { pageLocals } from "../config/pageAssets.js";
import {
    listPublicSelectionFacilities,
    PUBLIC_SELECTION_SCHEMA_VERSION
} from "../storecalc/publicSelection.js";

export function showStoreCalcPage(req, res) {
    return res.render(
        "storecalc/index",
        pageLocals("storecalc", {
            pageDescription:
                "Preview StoreCalc's private, phone-first facility and commissary-template workflow. Calculation remains unavailable until a reviewed catalog is ready.",
            currentUrl: "/storecalc",
            disableAnalytics: true,
            publicSelectionFacilities: listPublicSelectionFacilities(),
            publicSelectionSchemaVersion: PUBLIC_SELECTION_SCHEMA_VERSION
        })
    );
}
