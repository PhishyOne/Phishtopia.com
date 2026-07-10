import crypto from "crypto";
import express from "express";

import { getCloudflareAnalyticsReport } from "../services/cloudflareReport.service.js";
import { sendCloudflareAnalyticsEmail } from "../services/email.service.js";

const router = express.Router();

function safeEqual(left, right) {
    const leftBuffer = Buffer.from(left || "");
    const rightBuffer = Buffer.from(right || "");

    if (leftBuffer.length !== rightBuffer.length) {
        return false;
    }

    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function requireAnalyticsReportKey(req, res, next) {
    const configuredKey = process.env.ANALYTICS_REPORT_KEY?.trim();

    if (!configuredKey) {
        return res.status(503).json({
            error: "Analytics reporting is not configured"
        });
    }

    const suppliedKey = req.get("x-analytics-report-key")?.trim();

    if (!safeEqual(suppliedKey, configuredKey)) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    return next();
}

function parseDays(value) {
    return Math.max(1, Math.min(31, Number.parseInt(value, 10) || 7));
}

router.get("/cloudflare", requireAnalyticsReportKey, async (req, res, next) => {
    try {
        const report = await getCloudflareAnalyticsReport({
            days: parseDays(req.query.days)
        });

        res.set("Cache-Control", "no-store");
        return res.status(200).json(report);
    } catch (error) {
        return next(error);
    }
});

router.post("/cloudflare/send", requireAnalyticsReportKey, async (req, res, next) => {
    try {
        const email = process.env.ANALYTICS_REPORT_RECIPIENT?.trim();

        if (!email) {
            return res.status(503).json({
                error: "ANALYTICS_REPORT_RECIPIENT is not configured"
            });
        }

        const report = await getCloudflareAnalyticsReport({
            days: parseDays(req.query.days)
        });

        const emailResult = await sendCloudflareAnalyticsEmail({
            email,
            report
        });

        return res.status(200).json({
            ok: true,
            sent: emailResult.sent,
            recipient: email,
            period: report.period
        });
    } catch (error) {
        return next(error);
    }
});

export default router;
