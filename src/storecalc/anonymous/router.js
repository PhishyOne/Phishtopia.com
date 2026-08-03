import express from "express";
import rateLimit from "express-rate-limit";

import {
    anonymousCalculationErrorBody,
    ANONYMOUS_CALCULATION_RESPONSE_SCHEMA_VERSION,
    createAnonymousCalculationService,
    StoreCalcAnonymousCalculationError
} from "./service.js";

export const ANONYMOUS_CALCULATION_ROUTE_PATH = "/api/v1/calculate";
export const ANONYMOUS_CALCULATION_BODY_LIMIT = "128kb";
export const ANONYMOUS_CALCULATION_RATE_LIMIT = Object.freeze({
    windowMs: 60 * 1000,
    max: 30
});

function applyPrivateResponseHeaders(res) {
    res.set("Cache-Control", "private, no-store");
    res.set("X-Robots-Tag", "noindex, nofollow");
    res.set("X-Content-Type-Options", "nosniff");
}

function sendFixedError(res, status, code) {
    applyPrivateResponseHeaders(res);
    return res.status(status).json({
        responseSchemaVersion:
            ANONYMOUS_CALCULATION_RESPONSE_SCHEMA_VERSION,
        success: false,
        error: { code }
    });
}

function createCalculationLimiter() {
    return rateLimit({
        ...ANONYMOUS_CALCULATION_RATE_LIMIT,
        standardHeaders: true,
        legacyHeaders: false,
        handler(req, res) {
            return sendFixedError(res, 429, "rate_limited");
        }
    });
}

function requireJson(req, res, next) {
    if (!req.is("application/json")) {
        return sendFixedError(res, 415, "json_content_type_required");
    }
    return next();
}

function handleCalculation(service) {
    return function anonymousCalculationHandler(req, res) {
        applyPrivateResponseHeaders(res);
        try {
            const result = service.calculate(req.body);
            return res.status(200).json({
                responseSchemaVersion:
                    ANONYMOUS_CALCULATION_RESPONSE_SCHEMA_VERSION,
                success: true,
                result
            });
        } catch (error) {
            const status =
                error instanceof StoreCalcAnonymousCalculationError
                    ? error.status
                    : 503;
            return res.status(status).json(anonymousCalculationErrorBody(error));
        }
    };
}

function handleParserError(error, req, res, next) {
    if (error?.type === "entity.too.large") {
        return sendFixedError(res, 413, "request_body_too_large");
    }
    if (error instanceof SyntaxError && error?.type === "entity.parse.failed") {
        return sendFixedError(res, 400, "invalid_json");
    }
    if (
        error?.type === "encoding.unsupported" ||
        error?.type === "charset.unsupported"
    ) {
        return sendFixedError(res, 415, "json_encoding_unsupported");
    }
    return next(error);
}

function methodNotAllowed(req, res) {
    res.set("Allow", "POST");
    return sendFixedError(res, 405, "method_not_allowed");
}

export function createAnonymousCalculationRouter({ registry }) {
    const router = express.Router();
    const service = createAnonymousCalculationService({ registry });

    router.post(
        ANONYMOUS_CALCULATION_ROUTE_PATH,
        createCalculationLimiter(),
        requireJson,
        express.json({
            limit: ANONYMOUS_CALCULATION_BODY_LIMIT,
            inflate: false,
            strict: true
        }),
        handleCalculation(service)
    );
    router.all(ANONYMOUS_CALCULATION_ROUTE_PATH, methodNotAllowed);
    router.use(handleParserError);

    return router;
}
