import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import ejs from "ejs";

import { pageLocals } from "../src/config/pageAssets.js";
import { showStoreCalcPage } from "../src/controllers/storecalc.controller.js";
import {
    listPublicSelectionFacilities,
    PUBLIC_SELECTION_SCHEMA_VERSION
} from "../src/storecalc/publicSelection.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const VIEW_PATH = path.join(ROOT, "views", "storecalc", "index.ejs");
const CLIENT_PATH = path.join(ROOT, "public", "js", "storecalc.js");
const STYLE_PATH = path.join(ROOT, "public", "styles", "storecalc.css");

const clientSource = readFileSync(CLIENT_PATH, "utf8");
const styleSource = readFileSync(STYLE_PATH, "utf8");

function captureControllerLocals(query = {}) {
    let capture;
    const response = {
        render(view, locals) {
            capture = { view, locals };
            return capture;
        }
    };

    showStoreCalcPage({ query }, response);
    return capture;
}

test("StoreCalc public selection fixture is exact, source-linked, and fail-closed", () => {
    assert.equal(PUBLIC_SELECTION_SCHEMA_VERSION, 1);

    const facilities = listPublicSelectionFacilities();
    assert.equal(facilities.length, 1);
    assert.deepEqual(facilities[0], {
        selectionKey: "us-ga-gdc-hays-state-prison",
        officialName: "Hays State Prison",
        country: {
            codeAlpha2: "US",
            name: "United States"
        },
        jurisdictionName: "Georgia",
        agencyName: "Georgia Department of Corrections",
        locality: "Trion, Georgia",
        facilityType: "State Prison",
        facilityStatus: "listed_by_agency",
        facilityStatusLabel: "Listed by agency",
        source: {
            title: "Hays State Prison — Georgia Department of Corrections",
            url: "https://gdc.georgia.gov/locations/hays-state-prison",
            checkedOn: "2026-08-03"
        },
        templateCoverage: {
            status: "unavailable",
            label: "No reviewed StoreCalc template",
            detail: "StoreCalc does not yet have source-backed items, prices, taxes, limits, or audience applicability for this facility."
        }
    });

    facilities[0].officialName = "mutated";
    facilities[0].source.url = "https://example.invalid";
    const freshFacilities = listPublicSelectionFacilities();
    assert.equal(freshFacilities[0].officialName, "Hays State Prison");
    assert.equal(
        freshFacilities[0].source.url,
        "https://gdc.georgia.gov/locations/hays-state-prison"
    );
    assert.equal(freshFacilities[0].templateCoverage.status, "unavailable");
    assert.equal("templates" in freshFacilities[0], false);
});

test("StoreCalc controller never accepts a facility selection from the URL", () => {
    const capture = captureControllerLocals({
        facility: "us-ga-gdc-hays-state-prison",
        template: "invented-template"
    });

    assert.equal(capture.view, "storecalc/index");
    assert.equal(capture.locals.publicSelectionSchemaVersion, 1);
    assert.equal(capture.locals.publicSelectionFacilities.length, 1);
    assert.equal("selectedFacility" in capture.locals, false);
    assert.equal("selectedTemplate" in capture.locals, false);
    assert.equal(capture.locals.currentUrl, "/storecalc");
    assert.equal(capture.locals.disableAnalytics, true);
    assert.match(capture.locals.pageDescription, /Calculation remains unavailable/);
});

test("StoreCalc shell renders an accessible private selection boundary", async () => {
    const controller = captureControllerLocals();
    const html = await ejs.renderFile(VIEW_PATH, {
        ...pageLocals("storecalc", controller.locals),
        canonicalUrl: "https://phishtopia.com/storecalc",
        user: null
    });

    assert.match(html, /<main class="storecalc-shell"[^>]*data-selection-schema-version="1"/);
    assert.match(html, /<h1 id="storecalc-title">Plan first\. Know the math\. Keep the choice private\.<\/h1>/);
    assert.match(html, /id="storecalc-facility"[^>]*data-storecalc-facility-selector/s);
    assert.match(html, /<option value="">Select a facility<\/option>/);
    assert.match(html, /value="us-ga-gdc-hays-state-prison"/);
    assert.doesNotMatch(html, /<option[^>]+selected/);
    assert.match(html, /data-storecalc-facility-panel="us-ga-gdc-hays-state-prison"[^>]*hidden/s);
    assert.match(html, /Hays State Prison/);
    assert.match(html, /Georgia Department of Corrections/);
    assert.match(html, /Trion, Georgia/);
    assert.match(html, /https:\/\/gdc\.georgia\.gov\/locations\/hays-state-prison/);
    assert.match(html, /The source confirms the facility record, not commissary items or rules\./);
    assert.match(html, /<select id="template-us-ga-gdc-hays-state-prison" disabled>/);
    assert.match(html, /No reviewed template available/);
    assert.match(html, /Calculation stays locked instead of guessing\./);
    assert.match(html, /aria-live="polite" aria-atomic="true"/);
    assert.match(html, /aria-current="step"/);
    assert.match(html, /Not placed in the URL, account, analytics, cookies, or browser storage\./);
    assert.doesNotMatch(html, /googletagmanager|dataLayer/);
    assert.doesNotMatch(html, /starting-funds|updateTotals|oninput=/);
    assert.doesNotMatch(html, /<form[^>]+action="\/storecalc"/);
});

test("StoreCalc browser selection is exact, ephemeral, and fail-closed", () => {
    const listeners = new Map();
    const selector = {
        value: "",
        addEventListener(name, handler) {
            listeners.set(name, handler);
        }
    };
    const emptyState = { hidden: true };
    const liveRegion = { textContent: "stale" };
    const panel = {
        hidden: false,
        dataset: {
            storecalcFacilityPanel: "us-ga-gdc-hays-state-prison",
            selectionAnnouncement:
                "Hays State Prison selected. No reviewed StoreCalc template is available yet."
        }
    };
    const document = {
        querySelector(selectorText) {
            return {
                "[data-storecalc-facility-selector]": selector,
                "[data-storecalc-selection-empty]": emptyState,
                "[data-storecalc-selection-live]": liveRegion
            }[selectorText];
        },
        querySelectorAll(selectorText) {
            assert.equal(selectorText, "[data-storecalc-facility-panel]");
            return [panel];
        }
    };

    vm.runInNewContext(clientSource, { document });

    assert.equal(panel.hidden, true, "initial load must not auto-select");
    assert.equal(emptyState.hidden, false);
    assert.equal(liveRegion.textContent, "");
    assert.equal(typeof listeners.get("change"), "function");

    selector.value = "us-ga-gdc-hays-state-prison";
    listeners.get("change")({ target: selector });
    assert.equal(panel.hidden, false);
    assert.equal(emptyState.hidden, true);
    assert.match(liveRegion.textContent, /No reviewed StoreCalc template/);

    selector.value = "tampered-selection";
    listeners.get("change")({ target: selector });
    assert.equal(selector.value, "");
    assert.equal(panel.hidden, true);
    assert.equal(emptyState.hidden, false);
    assert.match(liveRegion.textContent, /selection is unavailable/);

    for (const forbidden of [
        /\bfetch\s*\(/,
        /XMLHttpRequest/,
        /localStorage/,
        /sessionStorage/,
        /document\.cookie/,
        /URLSearchParams/,
        /\bhistory\./,
        /\blocation\./,
        /dataLayer/
    ]) {
        assert.doesNotMatch(clientSource, forbidden);
    }
});

test("StoreCalc shell styles preserve touch, focus, mobile, and motion boundaries", () => {
    assert.match(styleSource, /min-width: 320px/);
    assert.match(styleSource, /min-height: 52px/);
    assert.match(styleSource, /:focus-visible/);
    assert.match(styleSource, /@media \(max-width: 680px\)/);
    assert.match(styleSource, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(styleSource, /\.storecalc-selection-empty\[hidden\]/);
    assert.doesNotMatch(styleSource, /^input\[type="number"\]/m);
});
