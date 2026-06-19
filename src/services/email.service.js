import nodemailer from "nodemailer";

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
    const verifyUrl = `https://phishtopia.com/auth/verify-email?token=${verificationToken}`;

    if (process.env.SEND_EMAIL === "false") {
        console.log("Email sending disabled. Verification link:", verifyUrl);
        return { sent: false, verifyUrl };
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
