import { type SolarScore, THRESHOLD } from "./solar.js";

export type TelegramDecision = "ON" | "OFF" | "AUTO";

const TELEGRAM_WAIT_MS = Number(process.env.TELEGRAM_TIMEOUT_MIN ?? 10) * 60 * 1000;

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function telegramPost(method: string, body: object): Promise<any> {
    const token = process.env.TELEGRAM_BOT_TOKEN!;
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    return res.json();
}

async function getLatestUpdateId(): Promise<number> {
    const token = process.env.TELEGRAM_BOT_TOKEN!;
    const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates?limit=1&offset=-1`);
    const data = await res.json();
    if (data.ok && data.result.length > 0) {
        return data.result[data.result.length - 1].update_id;
    }
    return 0;
}

function buildTelegramMessage(solar: SolarScore): string {
    const autoLabel = solar.needsHeater ? "🔥 ON" : "✅ OFF";
    const waitMin = Number(process.env.TELEGRAM_TIMEOUT_MIN ?? 10);

    return [
        "<b>☀️ Solar Heater — Daily Decision</b>",
        "",
        "<pre>",
        `Shortwave : ${solar.raw.shortwaveAvg.toFixed(0)} W/m²  → ${pct(solar.components.shortwave)} (40%)`,
        `Direct    : ${solar.raw.directAvg.toFixed(0)} W/m²  → ${pct(solar.components.direct)} (30%)`,
        `Sunshine  : ${solar.raw.sunshineAvg.toFixed(0)} s/hr  → ${pct(solar.components.sunshine)} (20%)`,
        `Cloud-free: ${(100 - solar.raw.cloudAvg).toFixed(0)}%       → ${pct(solar.components.cloudClear)} (10%)`,
        `Rain      : ${solar.raw.precipTotal.toFixed(1)} mm   → ×${solar.components.precipPenalty}`,
        "─────────────────────────────────",
        `Score     : ${pct(solar.score)}  (threshold: ${pct(THRESHOLD)})`,
        `Auto      : ${autoLabel}`,
        "</pre>",
        "",
        `Override or confirm below <i>(auto-executes in ${waitMin} min)</i>:`,
    ].join("\n");
}

export async function askTelegram(solar: SolarScore): Promise<TelegramDecision> {
    const chatId = process.env.TELEGRAM_CHAT_ID!;

    // Record the highest known update_id before sending so we only pick up
    // callback queries that arrive after our message.
    const startOffset = await getLatestUpdateId();

    const sent = await telegramPost("sendMessage", {
        chat_id: chatId,
        text: buildTelegramMessage(solar),
        parse_mode: "HTML",
        reply_markup: {
            inline_keyboard: [[
                { text: "🔥 Turn ON", callback_data: "ON" },
                { text: "❌ Turn OFF", callback_data: "OFF" },
                { text: "🤖 Auto", callback_data: "AUTO" },
            ]],
        },
    });

    if (!sent.ok) {
        console.log("Telegram sendMessage failed:", JSON.stringify(sent));
        return "AUTO";
    }

    const sentMessageId: number = sent.result.message_id;
    const deadline = Date.now() + TELEGRAM_WAIT_MS;
    let offset = startOffset + 1;

    const waitMin = Number(process.env.TELEGRAM_TIMEOUT_MIN ?? 10);
    console.log(`Telegram message sent (id: ${sentMessageId}). Waiting up to ${waitMin} min for response…`);

    while (Date.now() < deadline) {
        const remainingSec = Math.floor((deadline - Date.now()) / 1000);
        const pollTimeout = Math.min(30, remainingSec);
        if (pollTimeout <= 0) break;

        // Use Telegram long-polling (up to 30 s per request) to avoid busy-waiting
        const data = await (
            await fetch(
                `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getUpdates?offset=${offset}&timeout=${pollTimeout}`,
            )
        ).json();

        if (!data.ok) {
            await sleep(5_000);
            continue;
        }

        for (const update of data.result as any[]) {
            offset = update.update_id + 1;
            const cb = update.callback_query;
            if (!cb) continue;

            const choice = cb.data as TelegramDecision;

            // Acknowledge the tap so the spinner disappears in the app
            await telegramPost("answerCallbackQuery", {
                callback_query_id: cb.id,
                text: choice === "AUTO" ? "Using automatic decision." : `Heater will be turned ${choice}.`,
            });

            // Remove the inline keyboard so the buttons can't be pressed again
            await telegramPost("editMessageReplyMarkup", {
                chat_id: chatId,
                message_id: sentMessageId,
                reply_markup: { inline_keyboard: [] },
            });

            console.log(`Telegram decision received: ${choice}`);
            return choice;
        }
    }

    // Timeout — update the message to signal auto-execution
    await telegramPost("editMessageReplyMarkup", {
        chat_id: chatId,
        message_id: sentMessageId,
        reply_markup: { inline_keyboard: [] },
    }).catch(() => { });

    console.log("Telegram timed out — falling back to automatic decision.");
    return "AUTO";
}
