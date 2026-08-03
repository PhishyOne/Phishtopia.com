import { createPublicCalculationCatalogRegistry } from "./catalogRegistry.js";

// Public calculation remains fail-closed until a reviewed, source-backed
// facility catalog is added through its own gated change.
export const publicCalculationCatalogRegistry =
    createPublicCalculationCatalogRegistry([]);
