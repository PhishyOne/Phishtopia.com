import { sendErrorResponse } from "./errorResponses.js";

export function notFoundHandler(req, res) {
    return sendErrorResponse(req, res, 404);
}
