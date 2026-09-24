import { setDeviceStatus as setCloudDeviceStatus } from "./tuya-cloud.js";
import { setLocalDeviceStatus } from "./tuya-local.js";

export type TuyaMode = "cloud" | "local";

/**
 * Select the Tuya transport. Cloud mode is the default so existing GitHub
 * Actions deployments continue to work when TUYA_MODE is not configured.
 */
export function getTuyaMode(env: Record<string, string | undefined> = process.env): TuyaMode {
    const mode = env.TUYA_MODE?.trim().toLowerCase() || "cloud";

    if (mode !== "cloud" && mode !== "local") {
        throw new Error(`Invalid TUYA_MODE "${env.TUYA_MODE}". TUYA_MODE must be "cloud" or "local".`);
    }

    return mode;
}

export async function setDeviceStatus(status: boolean): Promise<void> {
    const mode = getTuyaMode();
    console.log(`Using Tuya ${mode} mode.`);

    if (mode === "local") {
        await setLocalDeviceStatus(status);
        return;
    }

    await setCloudDeviceStatus(status);
}
