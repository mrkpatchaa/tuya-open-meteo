import nodemailer from "nodemailer";
import { createHash, createHmac } from "crypto";

// Capture logs so they can be included in notification emails
const logBuffer: string[] = [];
const originalConsoleLog = console.log;
console.log = (...args: any[]) => {
  const message = args.map(String).join(" ");
  logBuffer.push(message);
  originalConsoleLog(...args);
};

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

async function sendEmail(subject: string, text: string) {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  const logs = logBuffer.join("\n");
  const emailBody = `${text}\n\n---\nConsole Logs:\n${logs}`;

  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: process.env.EMAIL_TO,
    subject: process.env.MAIL_SUBJECT_PREFIX
      ? `${process.env.MAIL_SUBJECT_PREFIX} ${subject}`
      : subject,
    text: emailBody,
  });
}

// ---------------------------------------------------------------------------
// Open-Meteo — composite solar sufficiency score
// ---------------------------------------------------------------------------

// Weights must sum to 1.0
const WEIGHTS = {
  shortwave:  0.40, // W/m²  — actual solar energy at the surface (most direct)
  direct:     0.30, // W/m²  — direct beam only, most relevant for panel efficiency
  sunshine:   0.20, // s/hr  — independent measure of real sunshine
  cloudClear: 0.10, // %     — coarsest proxy, kept as a cross-check
};

// Approximate sunny-day averages for Morocco (9 am–4 pm window).
// Used to normalise each variable to a 0–1 scale.
const NORM = {
  shortwave:  700,  // W/m²
  direct:     600,  // W/m²
  sunshine:   3600, // s (full hour = completely sunny)
  cloudClear: 100,  // % clear sky
};

// Score threshold: below this value the heater turns ON.
// Configurable via SOLAR_SCORE_THRESHOLD env var (0–1).
const THRESHOLD = Number(process.env.SOLAR_SCORE_THRESHOLD ?? 0.50);

interface SolarScore {
  score: number;        // 0–1, higher = more solar gain
  needsHeater: boolean;
  components: {
    shortwave:    number; // normalised 0–1
    direct:       number;
    sunshine:     number;
    cloudClear:   number;
    precipPenalty: number;
  };
  raw: {
    shortwaveAvg:  number; // W/m²
    directAvg:     number; // W/m²
    sunshineAvg:   number; // s/hr
    cloudAvg:      number; // %
    precipTotal:   number; // mm
  };
}

async function getSolarScore(): Promise<SolarScore | null> {
  const vars = "shortwave_radiation,direct_radiation,sunshine_duration,cloud_cover,precipitation";
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${process.env.LATITUDE}&longitude=${process.env.LONGITUDE}&hourly=${vars}&timezone=auto&forecast_days=1`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.log(`Open-Meteo HTTP error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const h = data.hourly;

    // 9 am–4 pm local time (indices 9–16)
    const slice = (arr: number[]) => arr.slice(9, 16);
    const avg   = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const clamp = (v: number)     => Math.min(1, Math.max(0, v));

    const shortwaveAvg = avg(slice(h.shortwave_radiation));
    const directAvg    = avg(slice(h.direct_radiation));
    const sunshineAvg  = avg(slice(h.sunshine_duration));
    const cloudAvg     = avg(slice(h.cloud_cover));
    const precipTotal  = slice(h.precipitation).reduce((a: number, b: number) => a + b, 0);

    // Normalise each component to 0–1 (1 = maximum solar gain)
    const nShortwave  = clamp(shortwaveAvg / NORM.shortwave);
    const nDirect     = clamp(directAvg    / NORM.direct);
    const nSunshine   = clamp(sunshineAvg  / NORM.sunshine);
    const nCloudClear = clamp((100 - cloudAvg) / NORM.cloudClear);

    // Precipitation is a multiplicative penalty on the final score
    const precipPenalty = precipTotal > 2 ? 0.50   // heavy rain  → ×0.50
                        : precipTotal > 0.5 ? 0.75  // light rain  → ×0.75
                        : 1.0;                       // dry         → no change

    const rawScore =
      WEIGHTS.shortwave  * nShortwave  +
      WEIGHTS.direct     * nDirect     +
      WEIGHTS.sunshine   * nSunshine   +
      WEIGHTS.cloudClear * nCloudClear;

    const score = rawScore * precipPenalty;

    return {
      score,
      needsHeater: score < THRESHOLD,
      components: { shortwave: nShortwave, direct: nDirect, sunshine: nSunshine, cloudClear: nCloudClear, precipPenalty },
      raw: { shortwaveAvg, directAvg, sunshineAvg, cloudAvg, precipTotal },
    };
  } catch (error) {
    console.log("Error fetching weather data:", error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Tuya Cloud API helpers
// ---------------------------------------------------------------------------

const TUYA_BASE_URL = process.env.TUYA_BASE_URL ?? "https://openapi.tuyaeu.com";

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function hmacSha256(str: string, secret: string): string {
  return createHmac("sha256", secret).update(str).digest("hex").toUpperCase();
}

async function tuyaRequest(
  method: string,
  path: string,
  body: object | null = null,
  accessToken?: string,
): Promise<any> {
  const accessId = process.env.TUYA_ACCESS_ID!;
  const accessSecret = process.env.TUYA_ACCESS_SECRET!;
  const timestamp = Date.now().toString();

  const bodyStr = body ? JSON.stringify(body) : "";
  const contentHash = sha256(bodyStr);

  // Tuya OpenAPI v1 signing: method + \n + body_hash + \n + (no custom headers) + \n + path
  const stringToSign = `${method}\n${contentHash}\n\n${path}`;

  // Without access token (for /token endpoint): client_id + t + string_to_sign
  // With access token (for all other calls): client_id + access_token + t + string_to_sign
  const signStr = accessToken
    ? `${accessId}${accessToken}${timestamp}${stringToSign}`
    : `${accessId}${timestamp}${stringToSign}`;

  const sign = hmacSha256(signStr, accessSecret);

  const headers: Record<string, string> = {
    client_id: accessId,
    sign,
    t: timestamp,
    sign_method: "HMAC-SHA256",
    "Content-Type": "application/json",
  };

  if (accessToken) {
    headers.access_token = accessToken;
  }

  const res = await fetch(`${TUYA_BASE_URL}${path}`, {
    method,
    headers,
    body: body ? bodyStr : undefined,
  });

  return res.json();
}

async function getAccessToken(): Promise<string> {
  const data = await tuyaRequest("GET", "/v1.0/token?grant_type=1");
  if (!data.success) {
    throw new Error(`Failed to get Tuya access token: ${JSON.stringify(data)}`);
  }
  console.log("Tuya access token obtained.");
  return data.result.access_token;
}

// ---------------------------------------------------------------------------
// Device control
// ---------------------------------------------------------------------------

async function resolveSwitchCode(deviceId: string, accessToken: string): Promise<string> {
  // Allow explicit override via env var (e.g. TUYA_SWITCH_CODE=switch_1)
  if (process.env.TUYA_SWITCH_CODE) {
    return process.env.TUYA_SWITCH_CODE;
  }

  // Query the device's supported functions to discover the correct DP code
  const result = await tuyaRequest(
    "GET",
    `/v1.0/devices/${deviceId}/functions`,
    null,
    accessToken,
  );

  if (!result.success) {
    console.log("Could not fetch device functions, falling back to 'switch_1':", JSON.stringify(result));
    return "switch_1";
  }

  const functions: Array<{ code: string; type: string }> = result.result?.functions ?? [];
  console.log("Device functions:", functions.map((f) => `${f.code} (${f.type})`).join(", "));

  // Pick the first Boolean DP whose code looks like a switch/power/relay
  const switchFn =
    functions.find((f) => f.type === "Boolean" && /switch|power|relay/i.test(f.code)) ??
    functions.find((f) => f.type === "Boolean");

  const code = switchFn?.code ?? "switch_1";
  console.log(`Using DP code: "${code}"`);
  return code;
}

async function setDeviceStatus(status: boolean): Promise<void> {
  try {
    const accessToken = await getAccessToken();
    const deviceId = process.env.TUYA_DEVICE_ID!;

    const switchCode = await resolveSwitchCode(deviceId, accessToken);

    const result = await tuyaRequest(
      "POST",
      `/v1.0/devices/${deviceId}/commands`,
      { commands: [{ code: switchCode, value: status }] },
      accessToken,
    );

    if (!result.success) {
      throw new Error(`Tuya command failed: ${JSON.stringify(result)}`);
    }

    console.log(`Device turned ${status ? "ON" : "OFF"} via Tuya Cloud API (DP: "${switchCode}").`);

    await sendEmail(
      status ? "Solar Heater Activated" : "Solar Heater Deactivated",
      status
        ? "The solar heater has been switched ON — solar gain is insufficient today."
        : "The solar heater has been switched OFF — solar gain is sufficient today.",
    );
  } catch (error: any) {
    console.log("Error controlling device:", error);
    await sendEmail(
      "Error Controlling Device",
      `Failed to control the device: ${error.message}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Telegram — interactive decision prompt (optional)
// ---------------------------------------------------------------------------

const TELEGRAM_WAIT_MS = Number(process.env.TELEGRAM_TIMEOUT_MIN ?? 10) * 60 * 1000;

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
  const res = await fetch(
    `https://api.telegram.org/bot${token}/getUpdates?limit=1&offset=-1`,
  );
  const data = await res.json();
  if (data.ok && data.result.length > 0) {
    return data.result[data.result.length - 1].update_id;
  }
  return 0;
}

function buildTelegramMessage(solar: SolarScore): string {
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const autoLabel = solar.needsHeater ? "🔥 ON" : "✅ OFF";
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
    `Override or confirm below <i>(auto-executes in ${Number(process.env.TELEGRAM_TIMEOUT_MIN ?? 10)} min)</i>:`,
  ].join("\n");
}

type TelegramDecision = "ON" | "OFF" | "AUTO";

async function askTelegram(solar: SolarScore): Promise<TelegramDecision> {
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
        { text: "🔥 Turn ON",  callback_data: "ON"   },
        { text: "✅ Turn OFF", callback_data: "OFF"  },
        { text: "🤖 Auto",    callback_data: "AUTO" },
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
    // Use Telegram long-polling (up to 30 s per request) to avoid busy-waiting
    const pollTimeout = Math.min(30, remainingSec);
    if (pollTimeout <= 0) break;

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
        text: choice === "AUTO"
          ? "Using automatic decision."
          : `Heater will be turned ${choice}.`,
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
  }).catch(() => {});

  console.log("Telegram timed out — falling back to automatic decision.");
  return "AUTO";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const solar = await getSolarScore();

if (!solar) {
  await sendEmail(
    "Error Fetching Weather Data",
    "Could not fetch weather data from Open-Meteo. Check the logs for details.",
  );
} else {
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

  console.log("─── Solar score breakdown (9 am–4 pm average) ───");
  console.log(`  Shortwave radiation : ${solar.raw.shortwaveAvg.toFixed(0)} W/m²  → ${pct(solar.components.shortwave)} (weight 40%)`);
  console.log(`  Direct radiation    : ${solar.raw.directAvg.toFixed(0)} W/m²  → ${pct(solar.components.direct)} (weight 30%)`);
  console.log(`  Sunshine duration   : ${solar.raw.sunshineAvg.toFixed(0)} s/hr  → ${pct(solar.components.sunshine)} (weight 20%)`);
  console.log(`  Cloud-free sky      : ${(100 - solar.raw.cloudAvg).toFixed(0)}%  → ${pct(solar.components.cloudClear)} (weight 10%)`);
  console.log(`  Precipitation total : ${solar.raw.precipTotal.toFixed(1)} mm  → penalty ×${solar.components.precipPenalty}`);
  console.log(`  ──────────────────────────────────────────────`);
  console.log(`  Final score         : ${pct(solar.score)}  (threshold: ${pct(THRESHOLD)})`);
  console.log(`  Auto decision       : heater ${solar.needsHeater ? "ON" : "OFF"}`);

  let turnOn = solar.needsHeater;

  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
    const decision = await askTelegram(solar);
    if (decision !== "AUTO") {
      turnOn = decision === "ON";
      console.log(`Manual override applied: heater ${turnOn ? "ON" : "OFF"}`);
    } else {
      console.log(`No override — using auto decision: heater ${turnOn ? "ON" : "OFF"}`);
    }
  }

  await setDeviceStatus(turnOn);
}
