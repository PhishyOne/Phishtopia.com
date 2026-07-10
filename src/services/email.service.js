import nodemailer from "nodemailer";

function getAppBaseUrl() {
    return (process.env.APP_BASE_URL || "https://phishtopia.com").replace(/\/$/, "");
}

function createTransporter() {
    return nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        }
    });
}

function requireEmailConfiguration() {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
        throw new Error("Email credentials missing. Set EMAIL_USER and EMAIL_PASS or SEND_EMAIL=false.");
    }
}

function formatNumber(value) {
    return new Intl.NumberFormat("en-US").format(Number(value || 0));
}

function formatBytes(value) {
    const bytes = Number(value || 0);
    if (bytes < 1024) return `${bytes} B`;

    const units = ["KB", "MB", "GB", "TB"];
    let amount = bytes / 1024;
    let unitIndex = 0;

    while (amount >= 1024 && unitIndex < units.length - 1) {
        amount /= 1024;
        unitIndex += 1;
    }

    return `${amount.toFixed(amount >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function formatPercent(value) {
    return `${(Number(value || 0) * 100).toFixed(1)}%`;
}

function formatRankedRows(rows) {
    if (!rows?.length) return "None reported";
    return rows.map((row, index) => `${index + 1}. ${row.name}: ${formatNumber(row.requests)} requests`).join("\n");
}

function buildCloudflareReportText(report) {
    const { period, totals } = report;

    return [
        `Phishtopia Cloudflare analytics`,
        `Period: ${period.startDate} through ${period.endDate}`,
        "",
        `Total requests: ${formatNumber(totals.requests)}`,
        `Page views: ${formatNumber(totals.pageViews)}`,
        `Estimated unique visitors: ${formatNumber(totals.uniqueVisitorsEstimate)}`,
        `Bandwidth: ${formatBytes(totals.bytes)}`,
        `Cached requests: ${formatNumber(totals.cachedRequests)} (${formatPercent(totals.cacheRequestRatio)})`,
        `Cached bandwidth: ${formatBytes(totals.cachedBytes)} (${formatPercent(totals.cacheByteRatio)})`,
        `Threats: ${formatNumber(totals.threats)}`,
        "",
        "Top countries",
        formatRankedRows(report.topCountries),
        "",
        "Top paths",
        formatRankedRows(report.topPaths),
        "",
        "HTTP status codes",
        formatRankedRows(report.statusCodes),
        "",
        "Cache statuses",
        formatRankedRows(report.cacheStatuses),
        "",
        "The attached JSON contains the full structured report for automated analysis."
    ].join("\n");
}

export async function sendVerificationEmail({ email, verificationToken }) {
    const verifyUrl = `${getAppBaseUrl()}/auth/verify-email?token=${verificationToken}`;

    if (process.env.SEND_EMAIL === "false") {
        console.log("Email sending disabled. Verification link:", verifyUrl);
        return { sent: false, verifyUrl };
    }

    requireEmailConfiguration();
    const transporter = createTransporter();

    await transporter.sendMail({
        from: `"Phishtopia" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: "Verify your email",
        html: `<p>Click the link to verify your email:</p><a href="${verifyUrl}">${verifyUrl}</a>`
    });

    return { sent: true, verifyUrl };
}

export async function sendCloudflareAnalyticsEmail({ email, report }) {
    if (process.env.SEND_EMAIL === "false") {
        console.log("Email sending disabled. Cloudflare report:", JSON.stringify(report));
        return { sent: false };
    }

    requireEmailConfiguration();
    const transporter = createTransporter();
    const filename = `phishtopia-cloudflare-${report.period.startDate}-to-${report.period.endDate}.json`;

    await transporter.sendMail({
        from: `"Phishtopia Analytics" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: `Phishtopia Cloudflare report: ${report.period.startDate} to ${report.period.endDate}`,
        text: buildCloudflareReportText(report),
        attachments: [
            {
                filename,
                content: JSON.stringify(report, null, 2),
                contentType: "application/json"
            }
        ]
    });

    return { sent: true };
}
