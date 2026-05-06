import { sendEmail } from "./email.js";
import { sendTelegramMessage } from "./telegram.js";

function telegramConfigured(): boolean {
    return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

function emailConfigured(): boolean {
    return Boolean(process.env.SMTP_HOST && process.env.EMAIL_TO);
}

/**
 * Send a notification via the best available channel:
 *  1. Telegram — when TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID are set
 *  2. Email    — when SMTP_HOST + EMAIL_TO are set
 *  3. Console  — no crash when neither is configured
 */
export async function sendNotification(subject: string, text: string): Promise<void> {
    if (telegramConfigured()) {
        await sendTelegramMessage(subject, text);
        return;
    }
    if (emailConfigured()) {
        await sendEmail(subject, text);
        return;
    }
    console.log(`[notify] No notification channel configured. Skipping: ${subject}`);
}
