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
    const transporter = createTransporter();
    const verifyUrl = `https://phishtopia.com/auth/verify-email?token=${verificationToken}`;

    await transporter.sendMail({
        from: `"Phishtopia" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: "Verify your email",
        html: `<p>Click the link to verify your email:</p><a href="${verifyUrl}">${verifyUrl}</a>`
    });
}
