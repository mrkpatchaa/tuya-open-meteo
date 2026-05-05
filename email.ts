import nodemailer from "nodemailer";
import { logBuffer } from "./logger.js";

export async function sendEmail(subject: string, text: string): Promise<void> {
    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT),
        secure: false,
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        },
    });

    const emailBody = `${text}\n\n---\nConsole Logs:\n${logBuffer.join("\n")}`;

    await transporter.sendMail({
        from: process.env.EMAIL_FROM,
        to: process.env.EMAIL_TO,
        subject: process.env.MAIL_SUBJECT_PREFIX
            ? `${process.env.MAIL_SUBJECT_PREFIX} ${subject}`
            : subject,
        text: emailBody,
    });
}
