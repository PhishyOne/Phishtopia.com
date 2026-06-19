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

export async function sendVerificationEmail({ email, verificationToken }) {
    const verifyUrl = `${getAppBaseUrl()}/auth/verify-email?token=${verificationToken}`;

    if (process.env.SEND_EMAIL === "false") {
        console.log("Email sending disabled. Verification link:", verifyUrl);
        return { sent: false, verifyUrl };
    }

    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
        throw new Error("Email credentials missing. Set EMAIL_USER and EMAIL_PASS or SEND_EMAIL=false.");
    }

    const transporter = createTransporter();

    await transporter.sendMail({
        from: `"Phishtopia" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: "Verify your email",
        html: `<p>Click the link to verify your email:</p><a href="${verifyUrl}">${verifyUrl}</a>`
    });

    return { sent: true, verifyUrl };
}
