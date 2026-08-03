(function initializeStoreCalcCalculator(globalObject) {
    "use strict";

    const VIEW_SCHEMA_VERSION = "storecalc.calculator-view.v1";
    const REQUEST_SCHEMA_VERSION = "storecalc.anonymous-calculation-request.v1";
    const RESPONSE_SCHEMA_VERSION =
        "storecalc.anonymous-calculation-response.v1";
    const CALCULATION_RESULT_SCHEMA_VERSION = "storecalc.calculation-result.v1";
    const CALCULATION_ENDPOINT = "/storecalc/api/v1/calculate";
    const KEY_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
    const HASH_PATTERN = /^[a-f0-9]{64}$/;
    const UNSIGNED_INTEGER_PATTERN = /^(?:0|[1-9][0-9]*)$/;
    const SIGNED_INTEGER_PATTERN = /^(?:0|-?[1-9][0-9]*)$/;
    const MAX_MONEY_MINOR = "9223372036854775807";
    const MAX_QUANTITY = "1000000";
    const MAX_ITEMS = 1000;

    const RESPONSE_ERROR_MESSAGES = Object.freeze({
        invalid_request:
            "The calculation request was rejected. Review the quantities and try again.",
        catalog_unavailable:
            "This reviewed catalog is no longer available. Refresh the page before calculating again.",
        configuration_stale:
            "The catalog changed after this page loaded. Refresh the page before calculating again.",
        calculation_request_invalid:
            "One or more quantities do not satisfy the reviewed catalog rules.",
        calculation_unavailable:
            "The calculator is temporarily unavailable. No order information was saved.",
        rate_limited:
            "Too many calculations were requested. Wait a moment and try again.",
        json_content_type_required:
            "The calculator could not submit a valid request. Refresh the page and try again.",
        request_body_too_large:
            "The calculation request is too large. Reduce the number of selected items.",
        invalid_json:
            "The calculator received an invalid response. Refresh the page and try again.",
        json_encoding_unsupported:
            "The calculator could not submit a valid request. Refresh the page and try again.",
        method_not_allowed:
            "The calculator endpoint rejected this request. Refresh the page and try again."
    });

    const VALIDATION_MESSAGES = Object.freeze({
        item_unavailable: "A selected item is unavailable in this catalog.",
        item_availability_unknown:
            "A selected item's availability has not been confirmed.",
        quantity_below_minimum:
            "A selected quantity is below the catalog minimum.",
        quantity_above_maximum:
            "A selected quantity exceeds the catalog maximum.",
        quantity_step_mismatch:
            "A selected quantity does not follow the catalog increment.",
        item_price_unknown: "A selected item's price is unknown.",
        item_price_unsupported: "A selected item's price is unsupported.",
        item_tax_unknown: "Tax is unknown for a selected item.",
        item_tax_unsupported: "Tax is unsupported for a selected item.",
        bucket_amount_unknown:
            "A spending-bucket amount could not be confirmed.",
        bucket_amount_unsupported: "A spending-bucket amount is unsupported.",
        bucket_limit_unknown: "A spending-bucket limit is unknown.",
        bucket_limit_unsupported: "A spending-bucket limit is unsupported.",
        bucket_limit_exceeded: "A reviewed spending limit was exceeded.",
        aggregate_constraint_failed:
            "A reviewed order constraint was not satisfied.",
        aggregate_constraint_unknown:
            "A reviewed order constraint has an unknown result.",
        aggregate_constraint_unsupported:
            "A reviewed order constraint is unsupported.",
        personal_funds_exceeded:
            "The final total exceeds the available funds entered."
    });

    class StoreCalcCalculatorClientError extends Error {
        constructor(code, message) {
            super(message);
            this.name = "StoreCalcCalculatorClientError";
            this.code = code;
        }
    }

    function fail(code, message) {
        throw new StoreCalcCalculatorClientError(code, message);
    }

    function isPlainObject(value) {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
            return false;
        }
        const prototype = Object.getPrototypeOf(value);
        return (
            prototype === null ||
            (Object.prototype.toString.call(value) === "[object Object]" &&
                Object.getPrototypeOf(prototype) === null)
        );
    }

    function parseBoundedUnsigned(value, maximum, code, message) {
        if (
            typeof value !== "string" ||
            !UNSIGNED_INTEGER_PATTERN.test(value) ||
            typeof maximum !== "string" ||
            !UNSIGNED_INTEGER_PATTERN.test(maximum) ||
            value.length > maximum.length ||
            maximum.length > MAX_MONEY_MINOR.length
        ) {
            fail(code, message);
        }
        const parsed = BigInt(value);
        if (parsed > BigInt(maximum)) fail(code, message);
        return parsed;
    }

    function normalizeCurrencyExponent(value) {
        if (!Number.isSafeInteger(value) || value < 0 || value > 3) {
            fail(
                "CLIENT_CONFIGURATION_INVALID",
                "The calculator configuration is invalid. Refresh the page and try again."
            );
        }
        return value;
    }

    function formatMinorUnits(minorUnits, currencyExponent, currencyCode) {
        const exponent = normalizeCurrencyExponent(currencyExponent);
        if (
            typeof minorUnits !== "string" ||
            !SIGNED_INTEGER_PATTERN.test(minorUnits) ||
            typeof currencyCode !== "string" ||
            !/^[A-Z]{3}$/.test(currencyCode)
        ) {
            fail(
                "CLIENT_RESPONSE_INVALID",
                "The calculator returned an invalid result. Refresh the page and try again."
            );
        }

        const negative = minorUnits.startsWith("-");
        const absolute = negative ? minorUnits.slice(1) : minorUnits;
        if (
            absolute.length > MAX_MONEY_MINOR.length ||
            BigInt(absolute) > BigInt(MAX_MONEY_MINOR)
        ) {
            fail(
                "CLIENT_RESPONSE_INVALID",
                "The calculator returned an invalid result. Refresh the page and try again."
            );
        }
        const padded = absolute.padStart(exponent + 1, "0");
        const whole = exponent === 0 ? padded : padded.slice(0, -exponent);
        const fraction = exponent === 0 ? "" : `.${padded.slice(-exponent)}`;
        return `${currencyCode} ${negative ? "-" : ""}${whole}${fraction}`;
    }

    function parseMoneyToMinorUnits(
        rawValue,
        currencyExponent,
        maximumFundsMinor
    ) {
        const exponent = normalizeCurrencyExponent(currencyExponent);
        if (typeof rawValue !== "string") {
            fail(
                "FUNDS_INVALID",
                "Enter available funds as a plain decimal amount."
            );
        }
        const value = rawValue.trim();
        if (!value) return null;
        parseBoundedUnsigned(
            maximumFundsMinor,
            MAX_MONEY_MINOR,
            "CLIENT_CONFIGURATION_INVALID",
            "The calculator configuration is invalid. Refresh the page and try again."
        );
        if (value.length > 24) {
            fail(
                "FUNDS_INVALID",
                "Available funds are outside the supported range."
            );
        }

        const pattern =
            exponent === 0
                ? /^(0|[1-9][0-9]*)$/
                : new RegExp(`^(0|[1-9][0-9]*)(?:\\.([0-9]{1,${exponent}}))?$`);
        const match = pattern.exec(value);
        if (!match) {
            fail(
                "FUNDS_INVALID",
                `Enter available funds with no more than ${exponent} decimal places.`
            );
        }

        const scale = 10n ** BigInt(exponent);
        const fraction =
            exponent === 0 ? "" : (match[2] ?? "").padEnd(exponent, "0");
        const minorUnits = BigInt(match[1]) * scale + BigInt(fraction || "0");
        parseBoundedUnsigned(
            minorUnits.toString(),
            maximumFundsMinor,
            "FUNDS_INVALID",
            "Available funds are outside the supported range."
        );
        return minorUnits.toString();
    }

    function normalizeKey(value) {
        if (
            typeof value !== "string" ||
            value.length > 64 ||
            !KEY_PATTERN.test(value)
        ) {
            fail(
                "CLIENT_CONFIGURATION_INVALID",
                "The calculator configuration is invalid. Refresh the page and try again."
            );
        }
        return value;
    }

    function normalizeDate(value) {
        if (typeof value !== "string") return false;
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
        if (!match) return false;
        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);
        const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
        const daysByMonth = [
            31,
            leap ? 29 : 28,
            31,
            30,
            31,
            30,
            31,
            31,
            30,
            31,
            30,
            31
        ];
        return (
            year >= 1 &&
            month >= 1 &&
            month <= 12 &&
            day >= 1 &&
            day <= daysByMonth[month - 1]
        );
    }

    function readMetadata(root) {
        const data = root?.dataset;
        if (
            !data ||
            data.viewSchemaVersion !== VIEW_SCHEMA_VERSION ||
            data.calculationEndpoint !== CALCULATION_ENDPOINT ||
            data.requestSchemaVersion !== REQUEST_SCHEMA_VERSION ||
            data.responseSchemaVersion !== RESPONSE_SCHEMA_VERSION ||
            !HASH_PATTERN.test(data.configurationHash ?? "") ||
            !normalizeDate(data.contextDate) ||
            !/^[A-Z]{3}$/.test(data.currencyCode ?? "")
        ) {
            fail(
                "CLIENT_CONFIGURATION_INVALID",
                "The calculator configuration is invalid. Refresh the page and try again."
            );
        }

        const currencyExponent = Number(data.currencyExponent);
        normalizeCurrencyExponent(currencyExponent);
        parseBoundedUnsigned(
            data.maximumFundsMinor,
            MAX_MONEY_MINOR,
            "CLIENT_CONFIGURATION_INVALID",
            "The calculator configuration is invalid. Refresh the page and try again."
        );

        return Object.freeze({
            endpoint: data.calculationEndpoint,
            requestSchemaVersion: data.requestSchemaVersion,
            responseSchemaVersion: data.responseSchemaVersion,
            facilitySelectionKey: normalizeKey(data.facilitySelectionKey),
            templateSelectionKey: normalizeKey(data.templateSelectionKey),
            audienceKey: normalizeKey(data.audienceKey),
            configurationHash: data.configurationHash,
            contextDate: data.contextDate,
            currencyCode: data.currencyCode,
            currencyExponent,
            maximumFundsMinor: data.maximumFundsMinor
        });
    }

    function normalizeItemInput(item) {
        if (!isPlainObject(item)) {
            fail("QUANTITY_INVALID", "A selected quantity is invalid.");
        }
        const itemKey = normalizeKey(item.itemKey);
        const minimum = parseBoundedUnsigned(
            item.minimumSelectedQuantity,
            MAX_QUANTITY,
            "CLIENT_CONFIGURATION_INVALID",
            "The calculator configuration is invalid. Refresh the page and try again."
        );
        const maximum = parseBoundedUnsigned(
            item.maximumOrderQuantity,
            MAX_QUANTITY,
            "CLIENT_CONFIGURATION_INVALID",
            "The calculator configuration is invalid. Refresh the page and try again."
        );
        const step = parseBoundedUnsigned(
            item.quantityStep,
            MAX_QUANTITY,
            "CLIENT_CONFIGURATION_INVALID",
            "The calculator configuration is invalid. Refresh the page and try again."
        );
        if (
            minimum < 1n ||
            maximum < minimum ||
            step < 1n ||
            typeof item.selectable !== "boolean"
        ) {
            fail(
                "CLIENT_CONFIGURATION_INVALID",
                "The calculator configuration is invalid. Refresh the page and try again."
            );
        }
        const rawQuantity =
            typeof item.quantity === "string" ? item.quantity.trim() : "";
        if (
            rawQuantity.length > MAX_QUANTITY.length ||
            !UNSIGNED_INTEGER_PATTERN.test(rawQuantity)
        ) {
            fail(
                "QUANTITY_INVALID",
                `${item.displayName || "An item"} needs a whole-number quantity.`
            );
        }
        const quantity = BigInt(rawQuantity);
        if (quantity === 0n) return { itemKey, quantity: "0" };
        if (
            !item.selectable ||
            quantity < minimum ||
            quantity > maximum ||
            (quantity - minimum) % step !== 0n
        ) {
            fail(
                "QUANTITY_INVALID",
                `${item.displayName || "An item"} must be zero or a permitted catalog quantity.`
            );
        }
        return { itemKey, quantity: quantity.toString() };
    }

    function buildCalculationRequest(metadata, items, rawFunds) {
        if (
            !isPlainObject(metadata) ||
            !Array.isArray(items) ||
            items.length > MAX_ITEMS ||
            metadata.endpoint !== CALCULATION_ENDPOINT ||
            metadata.requestSchemaVersion !== REQUEST_SCHEMA_VERSION ||
            metadata.responseSchemaVersion !== RESPONSE_SCHEMA_VERSION ||
            typeof metadata.currencyCode !== "string" ||
            !/^[A-Z]{3}$/.test(metadata.currencyCode)
        ) {
            fail(
                "CLIENT_CONFIGURATION_INVALID",
                "The calculator configuration is invalid. Refresh the page and try again."
            );
        }
        const seen = new Set();
        const quantities = [];
        for (const item of items) {
            const normalized = normalizeItemInput(item);
            if (seen.has(normalized.itemKey)) {
                fail(
                    "CLIENT_CONFIGURATION_INVALID",
                    "The calculator configuration is invalid. Refresh the page and try again."
                );
            }
            seen.add(normalized.itemKey);
            if (normalized.quantity !== "0") quantities.push(normalized);
        }

        return {
            requestSchemaVersion: metadata.requestSchemaVersion,
            facilitySelectionKey: normalizeKey(metadata.facilitySelectionKey),
            templateSelectionKey: normalizeKey(metadata.templateSelectionKey),
            audienceKey: normalizeKey(metadata.audienceKey),
            configurationHash:
                typeof metadata.configurationHash === "string" &&
                HASH_PATTERN.test(metadata.configurationHash)
                    ? metadata.configurationHash
                    : fail(
                          "CLIENT_CONFIGURATION_INVALID",
                          "The calculator configuration is invalid. Refresh the page and try again."
                      ),
            contextDate: normalizeDate(metadata.contextDate)
                ? metadata.contextDate
                : fail(
                      "CLIENT_CONFIGURATION_INVALID",
                      "The calculator configuration is invalid. Refresh the page and try again."
                  ),
            quantities,
            availableFundsMinor: parseMoneyToMinorUnits(
                rawFunds,
                metadata.currencyExponent,
                metadata.maximumFundsMinor
            )
        };
    }

    function amountLabel(state, value, metadata, { signed = false } = {}) {
        if (state === "known") {
            if (
                typeof value !== "string" ||
                !(signed
                    ? SIGNED_INTEGER_PATTERN.test(value)
                    : UNSIGNED_INTEGER_PATTERN.test(value))
            ) {
                fail(
                    "CLIENT_RESPONSE_INVALID",
                    "The calculator returned an invalid result. Refresh the page and try again."
                );
            }
            return formatMinorUnits(
                value,
                metadata.currencyExponent,
                metadata.currencyCode
            );
        }
        if (value !== null) {
            fail(
                "CLIENT_RESPONSE_INVALID",
                "The calculator returned an invalid result. Refresh the page and try again."
            );
        }
        const labels = {
            not_applicable: "Not applicable",
            unknown: "Unknown",
            unsupported: "Unsupported"
        };
        if (!Object.hasOwn(labels, state)) {
            fail(
                "CLIENT_RESPONSE_INVALID",
                "The calculator returned an invalid result. Refresh the page and try again."
            );
        }
        return labels[state];
    }

    function buildResultMessages(result) {
        const messages = [];
        if (
            !Array.isArray(result.validations) ||
            !Array.isArray(result.warnings)
        ) {
            fail(
                "CLIENT_RESPONSE_INVALID",
                "The calculator returned an invalid result. Refresh the page and try again."
            );
        }
        if (
            result.validations.length > MAX_ITEMS ||
            result.warnings.length > MAX_ITEMS
        ) {
            fail(
                "CLIENT_RESPONSE_INVALID",
                "The calculator returned an invalid result. Refresh the page and try again."
            );
        }
        for (const validation of result.validations) {
            if (
                !isPlainObject(validation) ||
                typeof validation.code !== "string"
            ) {
                fail(
                    "CLIENT_RESPONSE_INVALID",
                    "The calculator returned an invalid result. Refresh the page and try again."
                );
            }
            messages.push(
                VALIDATION_MESSAGES[validation.code] ||
                    "A reviewed catalog rule needs attention."
            );
        }
        if (result.warnings.length > 0) {
            messages.push(
                "The reviewed catalog returned an informational notice; check the catalog boundary above."
            );
        }
        return [...new Set(messages)];
    }

    function normalizeCalculationResponse(body, metadata, items) {
        if (
            !isPlainObject(body) ||
            body.responseSchemaVersion !== metadata.responseSchemaVersion ||
            body.success !== true ||
            !isPlainObject(body.result)
        ) {
            fail(
                "CLIENT_RESPONSE_INVALID",
                "The calculator returned an invalid result. Refresh the page and try again."
            );
        }
        const result = body.result;
        if (
            result.resultSchemaVersion !== CALCULATION_RESULT_SCHEMA_VERSION ||
            typeof result.resultHash !== "string" ||
            !HASH_PATTERN.test(result.resultHash) ||
            result.configurationHash !== metadata.configurationHash ||
            result.contextDate !== metadata.contextDate ||
            result.currencyCode !== metadata.currencyCode ||
            result.currencyExponent !== metadata.currencyExponent ||
            !["complete", "incomplete", "invalid"].includes(
                result.calculationState
            ) ||
            !["passes_known_rules", "unknown", "violations"].includes(
                result.complianceState
            ) ||
            !isPlainObject(result.totals) ||
            !isPlainObject(result.availableFunds) ||
            !Array.isArray(result.lines) ||
            result.lines.length > MAX_ITEMS ||
            result.totals.totalScope !== "items_and_supported_tax_only" ||
            result.totals.facilityFeeState !== "unsupported" ||
            result.totals.facilityFeeMinor !== null
        ) {
            fail(
                "CLIENT_RESPONSE_INVALID",
                "The calculator returned an invalid result. Refresh the page and try again."
            );
        }

        const expectedKeys = new Set(items.map(item => item.itemKey));
        const lineTotals = [];
        const seen = new Set();
        for (const line of result.lines) {
            if (
                !isPlainObject(line) ||
                typeof line.itemKey !== "string" ||
                !expectedKeys.has(line.itemKey) ||
                seen.has(line.itemKey)
            ) {
                fail(
                    "CLIENT_RESPONSE_INVALID",
                    "The calculator returned an invalid result. Refresh the page and try again."
                );
            }
            seen.add(line.itemKey);
            lineTotals.push({
                itemKey: line.itemKey,
                label: amountLabel(
                    line.lineTotalState,
                    line.lineTotalMinor,
                    metadata
                )
            });
        }

        const remaining = result.availableFunds;
        let remainingLabel;
        if (remaining.state === "not_provided") {
            if (
                remaining.availableFundsMinor !== null ||
                remaining.remainingState !== "not_applicable" ||
                remaining.remainingMinor !== null
            ) {
                fail(
                    "CLIENT_RESPONSE_INVALID",
                    "The calculator returned an invalid result. Refresh the page and try again."
                );
            }
            remainingLabel = "Not provided";
        } else if (remaining.state === "known") {
            remainingLabel = amountLabel(
                remaining.remainingState,
                remaining.remainingMinor,
                metadata,
                { signed: true }
            );
        } else {
            fail(
                "CLIENT_RESPONSE_INVALID",
                "The calculator returned an invalid result. Refresh the page and try again."
            );
        }

        return Object.freeze({
            subtotalLabel: amountLabel(
                result.totals.itemSubtotalState,
                result.totals.itemSubtotalMinor,
                metadata
            ),
            taxLabel: amountLabel(
                result.totals.taxState,
                result.totals.taxMinor,
                metadata
            ),
            finalTotalLabel: amountLabel(
                result.totals.finalTotalState,
                result.totals.finalTotalMinor,
                metadata
            ),
            remainingLabel,
            lineTotals: Object.freeze(lineTotals),
            messages: Object.freeze(buildResultMessages(result)),
            complianceState: result.complianceState
        });
    }

    async function requestCalculation(
        endpoint,
        request,
        expectedResponseSchemaVersion,
        fetchImplementation = globalObject.fetch
    ) {
        if (
            endpoint !== CALCULATION_ENDPOINT ||
            expectedResponseSchemaVersion !== RESPONSE_SCHEMA_VERSION ||
            typeof fetchImplementation !== "function"
        ) {
            fail(
                "CLIENT_CONFIGURATION_INVALID",
                "The calculator configuration is invalid. Refresh the page and try again."
            );
        }

        let response;
        try {
            response = await fetchImplementation(endpoint, {
                method: "POST",
                credentials: "omit",
                cache: "no-store",
                redirect: "error",
                referrerPolicy: "no-referrer",
                headers: {
                    Accept: "application/json",
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(request)
            });
        } catch {
            fail(
                "CALCULATION_UNAVAILABLE",
                "The calculator is temporarily unavailable. No order information was saved."
            );
        }

        const contentType = response?.headers?.get?.("content-type");
        if (
            typeof contentType !== "string" ||
            !/^application\/json\b/i.test(contentType)
        ) {
            fail(
                "CLIENT_RESPONSE_INVALID",
                "The calculator returned an invalid result. Refresh the page and try again."
            );
        }

        let body;
        try {
            body = await response.json();
        } catch {
            fail(
                "CLIENT_RESPONSE_INVALID",
                "The calculator returned an invalid result. Refresh the page and try again."
            );
        }

        if (!response.ok) {
            const code =
                isPlainObject(body) &&
                isPlainObject(body.error) &&
                typeof body.error.code === "string"
                    ? body.error.code
                    : "calculation_unavailable";
            fail(
                code,
                RESPONSE_ERROR_MESSAGES[code] ||
                    "The calculator is temporarily unavailable. No order information was saved."
            );
        }
        return body;
    }

    function requireElement(root, selector) {
        const element = root.querySelector(selector);
        if (!element) {
            fail(
                "CLIENT_CONFIGURATION_INVALID",
                "The calculator configuration is invalid. Refresh the page and try again."
            );
        }
        return element;
    }

    function readRows(root) {
        const elements = Array.from(
            root.querySelectorAll("[data-storecalc-item]")
        );
        if (elements.length > MAX_ITEMS) {
            fail(
                "CLIENT_CONFIGURATION_INVALID",
                "The calculator configuration is invalid. Refresh the page and try again."
            );
        }
        return elements.map(element => {
            const data = element.dataset;
            const quantityInput = requireElement(
                element,
                "[data-storecalc-quantity]"
            );
            return {
                element,
                itemKey: normalizeKey(data.itemKey),
                displayName: data.itemName,
                minimumSelectedQuantity: data.minimumQuantity,
                maximumOrderQuantity: data.maximumQuantity,
                quantityStep: data.quantityStep,
                selectable:
                    data.selectable === "true"
                        ? true
                        : data.selectable === "false"
                          ? false
                          : fail(
                                "CLIENT_CONFIGURATION_INVALID",
                                "The calculator configuration is invalid. Refresh the page and try again."
                            ),
                quantityInput,
                decrementButton: requireElement(
                    element,
                    "[data-storecalc-decrement]"
                ),
                incrementButton: requireElement(
                    element,
                    "[data-storecalc-increment]"
                ),
                lineTotal: requireElement(
                    element,
                    "[data-storecalc-line-total]"
                )
            };
        });
    }

    function rowInput(row) {
        return {
            itemKey: row.itemKey,
            displayName: row.displayName,
            minimumSelectedQuantity: row.minimumSelectedQuantity,
            maximumOrderQuantity: row.maximumOrderQuantity,
            quantityStep: row.quantityStep,
            selectable: row.selectable,
            quantity: row.quantityInput.value
        };
    }

    function nextQuantity(row, direction) {
        const minimum = BigInt(row.minimumSelectedQuantity);
        const maximum = BigInt(row.maximumOrderQuantity);
        const step = BigInt(row.quantityStep);
        const raw = row.quantityInput.value.trim();
        let current = UNSIGNED_INTEGER_PATTERN.test(raw) ? BigInt(raw) : 0n;
        if (direction > 0) {
            current = current === 0n ? minimum : current + step;
            if (current > maximum) current = maximum;
        } else {
            current = current <= minimum ? 0n : current - step;
            if (current < minimum) current = 0n;
        }
        row.quantityInput.value = current.toString();
    }

    function mountCalculator(root, fetchImplementation = globalObject.fetch) {
        const metadata = readMetadata(root);
        const rows = readRows(root);
        const form = requireElement(root, "[data-storecalc-order-form]");
        const fundsInput = requireElement(root, "[data-storecalc-funds]");
        const calculateButton = requireElement(
            root,
            "[data-storecalc-calculate]"
        );
        const clearButton = requireElement(root, "[data-storecalc-clear]");
        const errorRegion = requireElement(root, "[data-storecalc-error]");
        const statusRegion = requireElement(root, "[data-storecalc-status]");
        const results = requireElement(root, "[data-storecalc-results]");
        const subtotal = requireElement(root, "[data-storecalc-subtotal]");
        const tax = requireElement(root, "[data-storecalc-tax]");
        const finalTotal = requireElement(root, "[data-storecalc-final-total]");
        const remaining = requireElement(root, "[data-storecalc-remaining]");
        const resultMessages = requireElement(
            root,
            "[data-storecalc-result-messages]"
        );
        const messageList = requireElement(
            root,
            "[data-storecalc-message-list]"
        );
        let busy = false;

        function clearError() {
            errorRegion.hidden = true;
            errorRegion.textContent = "";
        }

        function showError(error) {
            results.hidden = true;
            statusRegion.textContent = "";
            errorRegion.textContent =
                error instanceof StoreCalcCalculatorClientError
                    ? error.message
                    : "The calculator is temporarily unavailable. No order information was saved.";
            errorRegion.hidden = false;
            errorRegion.focus();
        }

        function invalidateResult(announcement = "") {
            results.hidden = true;
            for (const row of rows) row.lineTotal.textContent = "—";
            statusRegion.textContent = announcement;
        }

        function renderResult(view) {
            subtotal.textContent = view.subtotalLabel;
            tax.textContent = view.taxLabel;
            finalTotal.textContent = view.finalTotalLabel;
            remaining.textContent = view.remainingLabel;
            for (const row of rows) row.lineTotal.textContent = "—";
            for (const line of view.lineTotals) {
                const row = rows.find(
                    candidate => candidate.itemKey === line.itemKey
                );
                if (row) row.lineTotal.textContent = line.label;
            }

            messageList.replaceChildren();
            for (const message of view.messages) {
                const item = root.ownerDocument.createElement("li");
                item.textContent = message;
                messageList.append(item);
            }
            resultMessages.hidden = view.messages.length === 0;
            results.hidden = false;
            statusRegion.textContent =
                view.complianceState === "violations"
                    ? "Calculation complete. Review the rule warnings."
                    : view.complianceState === "unknown"
                      ? "Calculation complete with unknown or unsupported rules."
                      : "Calculation complete.";
        }

        for (const row of rows) {
            row.decrementButton.addEventListener("click", () => {
                nextQuantity(row, -1);
                clearError();
                invalidateResult(
                    "Quantity changed. Calculate again for a current total."
                );
            });
            row.incrementButton.addEventListener("click", () => {
                nextQuantity(row, 1);
                clearError();
                invalidateResult(
                    "Quantity changed. Calculate again for a current total."
                );
            });
            row.quantityInput.addEventListener("input", () => {
                clearError();
                invalidateResult(
                    "Quantity changed. Calculate again for a current total."
                );
            });
        }
        fundsInput.addEventListener("input", () => {
            clearError();
            invalidateResult(
                "Available funds changed. Calculate again for a current result."
            );
        });

        clearButton.addEventListener("click", () => {
            for (const row of rows) row.quantityInput.value = "0";
            fundsInput.value = "";
            clearError();
            invalidateResult("Quantities and available funds cleared.");
        });

        form.addEventListener("submit", async event => {
            event.preventDefault();
            if (busy) return;
            clearError();
            busy = true;
            calculateButton.disabled = true;
            form.setAttribute("aria-busy", "true");
            statusRegion.textContent = "Calculating on the server…";
            try {
                const inputs = rows.map(rowInput);
                const request = buildCalculationRequest(
                    metadata,
                    inputs,
                    fundsInput.value
                );
                const body = await requestCalculation(
                    metadata.endpoint,
                    request,
                    metadata.responseSchemaVersion,
                    fetchImplementation
                );
                renderResult(
                    normalizeCalculationResponse(body, metadata, inputs)
                );
            } catch (error) {
                showError(error);
            } finally {
                busy = false;
                calculateButton.disabled = false;
                form.removeAttribute("aria-busy");
            }
        });

        return Object.freeze({ metadata, itemCount: rows.length });
    }

    function mountAll(documentObject = globalObject.document) {
        if (!documentObject?.querySelectorAll) return 0;
        const roots = Array.from(
            documentObject.querySelectorAll("[data-storecalc-calculator]")
        );
        for (const root of roots) {
            try {
                mountCalculator(root);
            } catch (error) {
                const errorRegion = root.querySelector?.(
                    "[data-storecalc-error]"
                );
                if (errorRegion) {
                    errorRegion.textContent =
                        error instanceof StoreCalcCalculatorClientError
                            ? error.message
                            : "The calculator is unavailable. Refresh the page and try again.";
                    errorRegion.hidden = false;
                }
                const form = root.querySelector?.(
                    "[data-storecalc-order-form]"
                );
                if (form) {
                    for (const control of form.querySelectorAll(
                        "button, input"
                    )) {
                        control.disabled = true;
                    }
                }
            }
        }
        return roots.length;
    }

    const api = Object.freeze({
        VIEW_SCHEMA_VERSION,
        REQUEST_SCHEMA_VERSION,
        RESPONSE_SCHEMA_VERSION,
        CALCULATION_ENDPOINT,
        StoreCalcCalculatorClientError,
        formatMinorUnits,
        parseMoneyToMinorUnits,
        buildCalculationRequest,
        normalizeCalculationResponse,
        requestCalculation,
        mountCalculator,
        mountAll
    });
    globalObject.StoreCalcCalculatorClient = api;

    if (globalObject.document?.readyState === "loading") {
        globalObject.document.addEventListener("DOMContentLoaded", () => {
            mountAll();
        });
    } else if (globalObject.document) {
        mountAll();
    }
})(globalThis);
