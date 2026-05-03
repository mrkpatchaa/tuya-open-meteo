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
// Open-Meteo weather
// ---------------------------------------------------------------------------

async function getAverageCloudCover(): Promise<number> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${process.env.LATITUDE}&longitude=${process.env.LONGITUDE}&hourly=cloud_cover&timezone=auto&forecast_days=1`;
  console.log(url);
  try {
    const response = await fetch(url);

    if (!response.ok) {
      console.log(`HTTP error fetching weather: ${response.status}`);
      return -1;
    }

    const data = await response.json();

    // Average cloud cover between 9 am and 4 pm local time
    const cloudCoverDaytime = data.hourly.cloud_cover.slice(9, 16);
    const avg =
      cloudCoverDaytime.reduce((a: number, b: number) => a + b, 0) /
      cloudCoverDaytime.length;

    return avg;
  } catch (error) {
    console.log("Error fetching weather data:", error);
    return -1;
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
        ? "The solar heater has been switched ON — cloud cover is high (>75%), solar gain is low."
        : "The solar heater has been switched OFF — it's a sunny day, solar gain is sufficient.",
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
// Main
// ---------------------------------------------------------------------------

const cloudCoverDaytimeAvg = await getAverageCloudCover();
console.log(`Average daytime cloud cover: ${cloudCoverDaytimeAvg.toFixed(1)}%`);

if (cloudCoverDaytimeAvg > -1) {
  // Switch ON when cloud cover > 75% (solar heater needed), OFF when sunny
  await setDeviceStatus(cloudCoverDaytimeAvg > 75);
} else {
  await sendEmail(
    "Error Fetching Weather Data",
    "Could not fetch weather data from Open-Meteo. Check the logs for details.",
  );
}
