import { createHash, createHmac } from "crypto";
import { sendEmail } from "./email.js";

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

async function resolveSwitchCode(deviceId: string, accessToken: string): Promise<string> {
    // Allow explicit override via env var (e.g. TUYA_SWITCH_CODE=switch_1)
    if (process.env.TUYA_SWITCH_CODE) {
        return process.env.TUYA_SWITCH_CODE;
    }

    const result = await tuyaRequest("GET", `/v1.0/devices/${deviceId}/functions`, null, accessToken);

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

export async function setDeviceStatus(status: boolean): Promise<void> {
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
    } catch (error: any) {
        console.log("Error controlling device:", error);
        await sendEmail("Error Controlling Device", `Failed to control the device: ${error.message}`).catch(
            (emailError) => console.log("Failed to send error notification email:", emailError),
        );
        return;
    }

    try {
        await sendEmail(
            status ? "Solar Heater Activated" : "Solar Heater Deactivated",
            status
                ? "The solar heater has been switched ON — solar gain is insufficient today."
                : "The solar heater has been switched OFF — solar gain is sufficient today.",
        );
    } catch (error: any) {
        console.log("Error sending notification email:", error);
    }
}
