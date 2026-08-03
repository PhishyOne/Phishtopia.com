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
    buildStoreCalcCalculatorViewModel,
    CALCULATOR_ENDPOINT,
    CALCULATOR_VIEW_SCHEMA_VERSION,
    formatStoreCalcMinorUnits,
    StoreCalcCalculatorViewError
} from "../src/storecalc/calculatorViewModel.js";
import {
    ANONYMOUS_CALCULATION_REQUEST_SCHEMA_VERSION,
    ANONYMOUS_CALCULATION_RESPONSE_SCHEMA_VERSION,
    createAnonymousCalculationService
} from "../src/storecalc/anonymous/service.js";
import { buildSyntheticConfiguration } from "./fixtures/storecalc-calculation-fixtures.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const INDEX_VIEW_PATH = path.join(ROOT, "views", "storecalc", "index.ejs");
const CALCULATOR_VIEW_PATH = path.join(
    ROOT,
    "views",
    "storecalc",
    "calculator.ejs"
);
const CLIENT_PATH = path.join(ROOT, "public", "js", "storecalc-calculator.js");
const STYLE_PATH = path.join(ROOT, "public", "styles", "storecalc.css");

const clientSource = readFileSync(CLIENT_PATH, "utf8");
const styleSource = readFileSync(STYLE_PATH, "utf8");

function buildViewModel(
    configuration = buildSyntheticConfiguration(),
    overrides = {}
) {
    return buildStoreCalcCalculatorViewModel({
        facilitySelectionKey: "synthetic-facility",
        facilityName: "Synthetic Facility",
        templateSelectionKey: "synthetic-template",
        templateName: "Synthetic reviewed template",
        audienceKey: "general-population",
        audienceLabel: "General population",
        contextDate: "2026-08-03",
        source: {
            title: "Synthetic acceptance source",
            url: "https://example.com/storecalc/catalog",
            checkedOn: "2026-08-03"
        },
        catalogNotice:
            "Synthetic data for automated acceptance tests only; never publish as facility facts.",
        configuration,
        ...overrides
    });
}

function metadataFromView(view) {
    return {
        endpoint: view.endpoint,
        requestSchemaVersion: view.requestSchemaVersion,
        responseSchemaVersion: view.responseSchemaVersion,
        facilitySelectionKey: view.facilitySelectionKey,
        templateSelectionKey: view.templateSelectionKey,
        audienceKey: view.audienceKey,
        configurationHash: view.configurationHash,
        contextDate: view.contextDate,
        currencyCode: view.currencyCode,
        currencyExponent: view.currencyExponent,
        maximumFundsMinor: view.maximumFundsMinor
    };
}

function itemInputsFromView(view, quantities = {}) {
    return view.items.map(item => ({
        itemKey: item.itemKey,
        displayName: item.displayName,
        minimumSelectedQuantity: item.minimumSelectedQuantity,
        maximumOrderQuantity: item.maximumOrderQuantity,
        quantityStep: item.quantityStep,
        selectable: item.selectable,
        quantity: quantities[item.itemKey] ?? "0"
    }));
}

function loadClient(contextValues = {}) {
    const context = vm.createContext({ ...contextValues });
    vm.runInContext(clientSource, context, { filename: CLIENT_PATH });
    return { context, client: context.StoreCalcCalculatorClient };
}

function fakeElement({ dataset = {}, value = "", hidden = false } = {}) {
    const listeners = new Map();
    const queryMap = new Map();
    const queryAllMap = new Map();
    return {
        dataset,
        value,
        hidden,
        disabled: false,
        textContent: "",
        children: [],
        attributes: new Map(),
        focused: false,
        addEventListener(name, handler) {
            const handlers = listeners.get(name) ?? [];
            handlers.push(handler);
            listeners.set(name, handlers);
        },
        async emit(name, event = {}) {
            for (const handler of listeners.get(name) ?? []) {
                await handler(event);
            }
        },
        querySelector(selector) {
            return queryMap.get(selector) ?? null;
        },
        querySelectorAll(selector) {
            return queryAllMap.get(selector) ?? [];
        },
        setQuery(selector, element) {
            queryMap.set(selector, element);
        },
        setQueryAll(selector, elements) {
            queryAllMap.set(selector, elements);
        },
        setAttribute(name, valueToSet) {
            this.attributes.set(name, valueToSet);
        },
        removeAttribute(name) {
            this.attributes.delete(name);
        },
        replaceChildren() {
            this.children = [];
        },
        append(child) {
            this.children.push(child);
        },
        focus() {
            this.focused = true;
        }
    };
}

function buildFakeCalculatorDom(view) {
    const root = fakeElement({
        dataset: {
            viewSchemaVersion: view.viewSchemaVersion,
            calculationEndpoint: view.endpoint,
            requestSchemaVersion: view.requestSchemaVersion,
            responseSchemaVersion: view.responseSchemaVersion,
            facilitySelectionKey: view.facilitySelectionKey,
            templateSelectionKey: view.templateSelectionKey,
            audienceKey: view.audienceKey,
            configurationHash: view.configurationHash,
            contextDate: view.contextDate,
            currencyCode: view.currencyCode,
            currencyExponent: view.currencyExponent.toString(),
            maximumFundsMinor: view.maximumFundsMinor
        }
    });
    root.ownerDocument = {
        createElement() {
            return fakeElement();
        }
    };

    const rows = view.items.map(item => {
        const element = fakeElement({
            dataset: {
                itemKey: item.itemKey,
                itemName: item.displayName,
                minimumQuantity: item.minimumSelectedQuantity,
                maximumQuantity: item.maximumOrderQuantity,
                quantityStep: item.quantityStep,
                selectable: item.selectable ? "true" : "false"
            }
        });
        const quantityInput = fakeElement({ value: "0" });
        const decrementButton = fakeElement();
        const incrementButton = fakeElement();
        const lineTotal = fakeElement();
        element.setQuery("[data-storecalc-quantity]", quantityInput);
        element.setQuery("[data-storecalc-decrement]", decrementButton);
        element.setQuery("[data-storecalc-increment]", incrementButton);
        element.setQuery("[data-storecalc-line-total]", lineTotal);
        return {
            itemKey: item.itemKey,
            element,
            quantityInput,
            decrementButton,
            incrementButton,
            lineTotal
        };
    });

    const elements = {
        form: fakeElement(),
        funds: fakeElement(),
        calculate: fakeElement(),
        clear: fakeElement(),
        error: fakeElement({ hidden: true }),
        status: fakeElement(),
        results: fakeElement({ hidden: true }),
        subtotal: fakeElement(),
        tax: fakeElement(),
        finalTotal: fakeElement(),
        remaining: fakeElement(),
        resultMessages: fakeElement({ hidden: true }),
        messageList: fakeElement()
    };
    const selectors = {
        "[data-storecalc-order-form]": elements.form,
        "[data-storecalc-funds]": elements.funds,
        "[data-storecalc-calculate]": elements.calculate,
        "[data-storecalc-clear]": elements.clear,
        "[data-storecalc-error]": elements.error,
        "[data-storecalc-status]": elements.status,
        "[data-storecalc-results]": elements.results,
        "[data-storecalc-subtotal]": elements.subtotal,
        "[data-storecalc-tax]": elements.tax,
        "[data-storecalc-final-total]": elements.finalTotal,
        "[data-storecalc-remaining]": elements.remaining,
        "[data-storecalc-result-messages]": elements.resultMessages,
        "[data-storecalc-message-list]": elements.messageList
    };
    for (const [selector, element] of Object.entries(selectors)) {
        root.setQuery(selector, element);
    }
    root.setQueryAll(
        "[data-storecalc-item]",
        rows.map(row => row.element)
    );
    return { root, rows, elements };
}

function captureControllerLocals() {
    let captured;
    showStoreCalcPage(
        { query: {} },
        {
            render(view, locals) {
                captured = { view, locals };
                return captured;
            }
        }
    );
    return captured;
}

function expectViewError(action, code) {
    assert.throws(action, error => {
        assert.ok(error instanceof StoreCalcCalculatorViewError);
        assert.equal(error.code, code);
        assert.equal(error.message, code);
        assert.match(error.path, /^\$/);
        return true;
    });
}

test("StoreCalc calculator view model seals exact reviewed display data", () => {
    const configuration = buildSyntheticConfiguration();
    const view = buildViewModel(configuration);

    assert.equal(view.viewSchemaVersion, CALCULATOR_VIEW_SCHEMA_VERSION);
    assert.equal(view.endpoint, CALCULATOR_ENDPOINT);
    assert.equal(
        view.requestSchemaVersion,
        ANONYMOUS_CALCULATION_REQUEST_SCHEMA_VERSION
    );
    assert.equal(
        view.responseSchemaVersion,
        ANONYMOUS_CALCULATION_RESPONSE_SCHEMA_VERSION
    );
    assert.equal(view.configurationHash, configuration.contentHash);
    assert.equal(view.maximumFundsMinor, "9223372036854775807");
    assert.equal(view.items.length, 3);
    assert.deepEqual(
        view.items.map(item => [
            item.itemKey,
            item.priceLabel,
            item.availabilityLabel,
            item.taxLabel,
            item.selectable
        ]),
        [
            [
                "sample-soup",
                "USD 0.90",
                "Available in this catalog",
                "Tax added after listed price",
                true
            ],
            [
                "sample-drink",
                "USD 1.95",
                "Available in this catalog",
                "Tax included in listed price",
                true
            ],
            [
                "sample-soap",
                "USD 3.00",
                "Available in this catalog",
                "Tax not applicable",
                true
            ]
        ]
    );
    assert.equal(Object.isFrozen(view), true);
    assert.equal(Object.isFrozen(view.items), true);
    assert.equal(Object.isFrozen(view.items[0]), true);
    assert.equal(formatStoreCalcMinorUnits("688", 2, "USD"), "USD 6.88");

    expectViewError(
        () =>
            buildViewModel(configuration, {
                source: {
                    title: "Unsafe source",
                    url: "http://example.com/catalog",
                    checkedOn: "2026-08-03"
                }
            }),
        "VIEW_SOURCE_URL_INVALID"
    );
    expectViewError(
        () => buildViewModel(configuration, { contextDate: "2026-02-30" }),
        "VIEW_DATE_INVALID"
    );

    const tampered = structuredClone(configuration);
    tampered.items[0].priceMinor = "91";
    expectViewError(
        () => buildViewModel(tampered),
        "VIEW_CONFIGURATION_INVALID"
    );

    const unsupported = buildSyntheticConfiguration(content => {
        content.requiredCapabilities.push("profiles.composition.v1");
    });
    expectViewError(
        () => buildViewModel(unsupported),
        "VIEW_CAPABILITY_UNSUPPORTED"
    );
});

test("StoreCalc calculator partial is accessible and carries no client prices", async () => {
    const configuration = buildSyntheticConfiguration(content => {
        const drink = content.items.find(
            item => item.itemKey === "sample-drink"
        );
        drink.priceState = "unknown";
        drink.priceMinor = null;
    });
    const view = buildViewModel(configuration, {
        facilityName: "Synthetic <Facility>"
    });
    const html = await ejs.renderFile(CALCULATOR_VIEW_PATH, {
        calculator: view
    });

    assert.match(html, /data-storecalc-calculator/);
    assert.match(
        html,
        /data-calculation-endpoint="\/storecalc\/api\/v1\/calculate"/
    );
    assert.match(html, /Synthetic &lt;Facility&gt;/);
    assert.match(html, /<form class="storecalc-order-form"[^>]*novalidate>/);
    assert.doesNotMatch(html, /<form[^>]+action=/);
    assert.match(html, /<fieldset class="storecalc-items-fieldset">/);
    assert.match(html, /<legend>Choose quantities<\/legend>/);
    assert.match(html, /inputmode="decimal"/);
    assert.match(html, /inputmode="numeric"/);
    assert.match(html, /data-storecalc-decrement/);
    assert.match(html, /data-storecalc-increment/);
    assert.match(html, /role="alert"[^>]*tabindex="-1"/s);
    assert.match(html, /role="status" aria-live="polite" aria-atomic="true"/);
    assert.match(html, /Server-calculated result/);
    assert.match(html, /Facility fees remain unsupported/);
    assert.match(html, /not saved or sent with cookies/);
    assert.match(
        html,
        /data-item-key="sample-drink"[\s\S]*?data-storecalc-quantity[\s\S]*?disabled/
    );
    assert.doesNotMatch(html, /data-(?:unit-)?price/);
    assert.doesNotMatch(html, /on(?:click|input|change|submit)=/);
    assert.doesNotMatch(html, /Synthetic <Facility>/);
});

test("StoreCalc production remains closed and its calculator asset is inert", async () => {
    const controller = captureControllerLocals();
    assert.equal(controller.locals.publicCalculator, null);

    const html = await ejs.renderFile(INDEX_VIEW_PATH, {
        ...pageLocals("storecalc", controller.locals),
        canonicalUrl: "https://phishtopia.com/storecalc",
        user: null
    });
    assert.match(html, /src="\/js\/storecalc-calculator\.js"/);
    assert.doesNotMatch(html, /data-storecalc-calculator(?:\s|>)/);
    assert.doesNotMatch(html, /Reviewed calculation/);
    assert.doesNotMatch(html, /data-storecalc-order-form/);

    let queryCount = 0;
    let fetchCount = 0;
    const document = {
        readyState: "complete",
        querySelectorAll(selector) {
            queryCount += 1;
            assert.equal(selector, "[data-storecalc-calculator]");
            return [];
        }
    };
    const { client } = loadClient({
        document,
        fetch() {
            fetchCount += 1;
            throw new Error("calculator must remain inert");
        }
    });
    assert.equal(queryCount, 1);
    assert.equal(fetchCount, 0);
    assert.equal(Object.isFrozen(client), true);
});

test("StoreCalc browser client parses money and quantities without floating point", () => {
    const { client } = loadClient();
    const view = buildViewModel();
    const metadata = metadataFromView(view);

    assert.equal(
        client.parseMoneyToMinorUnits("7", 2, view.maximumFundsMinor),
        "700"
    );
    assert.equal(
        client.parseMoneyToMinorUnits("7.0", 2, view.maximumFundsMinor),
        "700"
    );
    assert.equal(
        client.parseMoneyToMinorUnits("7.00", 2, view.maximumFundsMinor),
        "700"
    );
    assert.equal(
        client.parseMoneyToMinorUnits("", 2, view.maximumFundsMinor),
        null
    );
    assert.equal(client.formatMinorUnits("688", 2, "USD"), "USD 6.88");
    assert.equal(client.formatMinorUnits("-275", 2, "USD"), "USD -2.75");

    for (const invalid of [
        "7.001",
        "07.00",
        "$7.00",
        "7,00",
        "NaN",
        "1e2",
        "-1"
    ]) {
        assert.throws(
            () =>
                client.parseMoneyToMinorUnits(
                    invalid,
                    2,
                    view.maximumFundsMinor
                ),
            error => error.code === "FUNDS_INVALID"
        );
    }
    assert.throws(
        () =>
            client.parseMoneyToMinorUnits(
                "92233720368547758.08",
                2,
                view.maximumFundsMinor
            ),
        error => error.code === "FUNDS_INVALID"
    );
    assert.throws(
        () => client.formatMinorUnits("9".repeat(1000), 2, "USD"),
        error => error.code === "CLIENT_RESPONSE_INVALID"
    );

    const request = client.buildCalculationRequest(
        metadata,
        itemInputsFromView(view, {
            "sample-soup": "2",
            "sample-drink": "1",
            "sample-soap": "0"
        }),
        "7.00"
    );
    assert.deepEqual(JSON.parse(JSON.stringify(request)), {
        requestSchemaVersion: ANONYMOUS_CALCULATION_REQUEST_SCHEMA_VERSION,
        facilitySelectionKey: "synthetic-facility",
        templateSelectionKey: "synthetic-template",
        audienceKey: "general-population",
        configurationHash: view.configurationHash,
        contextDate: "2026-08-03",
        quantities: [
            { itemKey: "sample-soup", quantity: "2" },
            { itemKey: "sample-drink", quantity: "1" }
        ],
        availableFundsMinor: "700"
    });
    assert.equal("clientTotalMinor" in request, false);
    assert.equal("prices" in request, false);
    assert.equal("source" in request, false);

    assert.throws(
        () =>
            client.buildCalculationRequest(
                metadata,
                itemInputsFromView(view, { "sample-soup": "5" }),
                ""
            ),
        error => error.code === "QUANTITY_INVALID"
    );
    assert.throws(
        () =>
            client.buildCalculationRequest(
                metadata,
                itemInputsFromView(view, { "sample-soup": "9".repeat(1000) }),
                ""
            ),
        error => error.code === "QUANTITY_INVALID"
    );
    assert.throws(
        () =>
            client.buildCalculationRequest(
                metadata,
                [...itemInputsFromView(view), itemInputsFromView(view)[0]],
                ""
            ),
        error => error.code === "CLIENT_CONFIGURATION_INVALID"
    );
});

test("StoreCalc browser request omits credentials, cache, and private side channels", async () => {
    const { client } = loadClient();
    const view = buildViewModel();
    const metadata = metadataFromView(view);
    const request = client.buildCalculationRequest(
        metadata,
        itemInputsFromView(view, { "sample-soup": "1" }),
        "5.00"
    );
    let captured;
    const responseBody = {
        responseSchemaVersion: ANONYMOUS_CALCULATION_RESPONSE_SCHEMA_VERSION,
        success: true,
        result: {}
    };
    const returned = await client.requestCalculation(
        CALCULATOR_ENDPOINT,
        request,
        ANONYMOUS_CALCULATION_RESPONSE_SCHEMA_VERSION,
        async (url, options) => {
            captured = { url, options };
            return {
                ok: true,
                headers: {
                    get(name) {
                        assert.equal(name, "content-type");
                        return "application/json; charset=utf-8";
                    }
                },
                async json() {
                    return responseBody;
                }
            };
        }
    );

    assert.equal(returned, responseBody);
    assert.equal(captured.url, CALCULATOR_ENDPOINT);
    assert.equal(captured.options.method, "POST");
    assert.equal(captured.options.credentials, "omit");
    assert.equal(captured.options.cache, "no-store");
    assert.equal(captured.options.redirect, "error");
    assert.equal(captured.options.referrerPolicy, "no-referrer");
    assert.deepEqual(
        JSON.parse(captured.options.body),
        JSON.parse(JSON.stringify(request))
    );
    assert.deepEqual(JSON.parse(JSON.stringify(captured.options.headers)), {
        Accept: "application/json",
        "Content-Type": "application/json"
    });
    assert.equal("keepalive" in captured.options, false);
});

test("StoreCalc browser and server agree on the synthetic acceptance result", () => {
    const { client } = loadClient();
    const configuration = buildSyntheticConfiguration();
    const view = buildViewModel(configuration);
    const metadata = metadataFromView(view);
    const inputs = itemInputsFromView(view, {
        "sample-soup": "2",
        "sample-drink": "1",
        "sample-soap": "1"
    });
    const request = client.buildCalculationRequest(metadata, inputs, "7.00");
    const service = createAnonymousCalculationService({
        registry: {
            resolve() {
                return { state: "available", configuration };
            }
        }
    });
    const result = service.calculate(JSON.parse(JSON.stringify(request)));
    const normalized = client.normalizeCalculationResponse(
        {
            responseSchemaVersion:
                ANONYMOUS_CALCULATION_RESPONSE_SCHEMA_VERSION,
            success: true,
            result
        },
        metadata,
        inputs
    );

    assert.equal(result.totals.finalTotalMinor, "688");
    assert.equal(normalized.subtotalLabel, "USD 6.62");
    assert.equal(normalized.taxLabel, "USD 0.26");
    assert.equal(normalized.finalTotalLabel, "USD 6.88");
    assert.equal(normalized.remainingLabel, "USD 0.12");
    assert.deepEqual(JSON.parse(JSON.stringify(normalized.lineTotals)), [
        { itemKey: "sample-soup", label: "USD 1.93" },
        { itemKey: "sample-drink", label: "USD 1.95" },
        { itemKey: "sample-soap", label: "USD 3.00" }
    ]);
    assert.deepEqual(JSON.parse(JSON.stringify(normalized.messages)), [
        "The reviewed catalog returned an informational notice; check the catalog boundary above."
    ]);

    assert.throws(
        () =>
            client.normalizeCalculationResponse(
                {
                    responseSchemaVersion:
                        ANONYMOUS_CALCULATION_RESPONSE_SCHEMA_VERSION,
                    success: true,
                    result: {
                        ...result,
                        configurationHash: "0".repeat(64)
                    }
                },
                metadata,
                inputs
            ),
        error => error.code === "CLIENT_RESPONSE_INVALID"
    );
});

test("StoreCalc mounted calculator renders only the returned server result", async () => {
    const { client } = loadClient();
    const configuration = buildSyntheticConfiguration();
    const view = buildViewModel(configuration);
    const { root, rows, elements } = buildFakeCalculatorDom(view);
    const service = createAnonymousCalculationService({
        registry: {
            resolve() {
                return { state: "available", configuration };
            }
        }
    });
    let requestCount = 0;
    const mounted = client.mountCalculator(root, async (url, options) => {
        requestCount += 1;
        assert.equal(url, CALCULATOR_ENDPOINT);
        const request = JSON.parse(options.body);
        const result = service.calculate(request);
        return {
            ok: true,
            headers: {
                get() {
                    return "application/json; charset=utf-8";
                }
            },
            async json() {
                return {
                    responseSchemaVersion:
                        ANONYMOUS_CALCULATION_RESPONSE_SCHEMA_VERSION,
                    success: true,
                    result
                };
            }
        };
    });

    assert.equal(mounted.itemCount, 3);
    await rows[0].incrementButton.emit("click");
    await rows[0].incrementButton.emit("click");
    await rows[1].incrementButton.emit("click");
    await rows[2].incrementButton.emit("click");
    elements.funds.value = "7.00";
    await elements.funds.emit("input");

    let prevented = false;
    await elements.form.emit("submit", {
        preventDefault() {
            prevented = true;
        }
    });

    assert.equal(prevented, true);
    assert.equal(requestCount, 1);
    assert.equal(elements.error.hidden, true);
    assert.equal(elements.results.hidden, false);
    assert.equal(elements.subtotal.textContent, "USD 6.62");
    assert.equal(elements.tax.textContent, "USD 0.26");
    assert.equal(elements.finalTotal.textContent, "USD 6.88");
    assert.equal(elements.remaining.textContent, "USD 0.12");
    assert.deepEqual(
        rows.map(row => row.lineTotal.textContent),
        ["USD 1.93", "USD 1.95", "USD 3.00"]
    );
    assert.equal(elements.resultMessages.hidden, false);
    assert.deepEqual(
        elements.messageList.children.map(child => child.textContent),
        [
            "The reviewed catalog returned an informational notice; check the catalog boundary above."
        ]
    );
    assert.equal(elements.status.textContent, "Calculation complete.");
    assert.equal(elements.calculate.disabled, false);
    assert.equal(elements.form.attributes.has("aria-busy"), false);

    await elements.clear.emit("click");
    assert.deepEqual(
        rows.map(row => row.quantityInput.value),
        ["0", "0", "0"]
    );
    assert.equal(elements.funds.value, "");
    assert.equal(elements.results.hidden, true);
    assert.equal(
        elements.status.textContent,
        "Quantities and available funds cleared."
    );
    assert.equal(requestCount, 1);

    rows[0].quantityInput.value = "5";
    await elements.form.emit("submit", { preventDefault() {} });
    assert.equal(requestCount, 1, "invalid input must fail before fetch");
    assert.equal(elements.results.hidden, true);
    assert.equal(elements.error.hidden, false);
    assert.equal(elements.error.focused, true);
    assert.match(elements.error.textContent, /permitted catalog quantity/);
    assert.equal(elements.calculate.disabled, false);
});

test("StoreCalc calculator client and styles preserve privacy and accessibility boundaries", () => {
    for (const forbidden of [
        /localStorage/,
        /sessionStorage/,
        /document\.cookie/,
        /URLSearchParams/,
        /\bhistory\./,
        /\blocation\./,
        /dataLayer/,
        /analytics/i,
        /innerHTML/,
        /insertAdjacentHTML/,
        /parseFloat/,
        /toFixed/,
        /\bIntl\./,
        /clientTotalMinor/
    ]) {
        assert.doesNotMatch(clientSource, forbidden);
    }
    assert.match(clientSource, /credentials: "omit"/);
    assert.match(clientSource, /cache: "no-store"/);
    assert.match(clientSource, /form\.addEventListener\("submit"/);
    assert.match(clientSource, /\.textContent =/);
    assert.match(clientSource, /errorRegion\.focus\(\)/);

    assert.match(styleSource, /\.storecalc-calculator\s*\{/);
    assert.match(styleSource, /\.storecalc-quantity-control/);
    assert.match(styleSource, /min-height: 52px/);
    assert.match(styleSource, /\.storecalc-calculator-error:focus-visible/);
    assert.match(styleSource, /@media \(max-width: 680px\)/);
    assert.match(styleSource, /@media \(prefers-reduced-motion: reduce\)/);
});
