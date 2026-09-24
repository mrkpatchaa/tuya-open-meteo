import TuyAPI from "tuyapi";
import { sendNotification } from "./notify.js";

export interface LocalDevice {
    on(event: "error", listener: (error: Error) => void): this;
    find(): Promise<boolean | unknown[]>;
    connect(): Promise<boolean>;
    set(options: { dps: number; set: boolean; shouldWaitForResponse?: boolean }): Promise<unknown>;
    isConnected(): boolean;
    disconnect(): void;
}

export type LocalDeviceFactory = (options: { id: string; key: string; issueGetOnConnect?: boolean }) => LocalDevice;

const createLocalDevice: LocalDeviceFactory = (options) => new TuyAPI({
    ...options,
    issueGetOnConnect: false,
});

function requiredEnv(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) {
        throw new Error(`${name} is required when TUYA_MODE=local.`);
    }
    return value;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * Control a Tuya device directly over the local network using TuyAPI.
 *
 * Local Tuya devices expose DP 1 as the default boolean property, which is
 * the same property used by the original LAN-based implementation.
 */
export async function setLocalDeviceStatus(
    status: boolean,
    deviceFactory: LocalDeviceFactory = createLocalDevice,
): Promise<void> {
    let device: LocalDevice | undefined;

    try {
        const id = requiredEnv("TUYA_DEVICE_ID");
        const key = requiredEnv("TUYA_DEVICE_KEY");
        device = deviceFactory({ id, key });

        // TuyAPI emits errors asynchronously. Keep a listener attached so an
        // expected discovery/connection failure does not become unhandled.
        device.on("error", (error) => {
            console.log("Local Tuya device error:", error);
        });

        console.log("Discovering Tuya device on the local network...");
        const found = await device.find();
        if (!found) {
            throw new Error("Tuya device was not found on the local network.");
        }

        const connected = await device.connect();
        if (!connected) {
            throw new Error("Could not connect to the Tuya device on the local network.");
        }

        const result = await device.set({
            dps: 1,
            set: status,
            shouldWaitForResponse: true,
        });
        if (result === false) {
            throw new Error("The Tuya device rejected the local command.");
        }

        console.log(`Device turned ${status ? "ON" : "OFF"} via Tuya local network API (DP: "1").`);
    } catch (error: unknown) {
        console.log("Error controlling local Tuya device:", error);
        await sendNotification("Error Controlling Device", `Failed to control the device locally: ${errorMessage(error)}`).catch(
            (notificationError) => console.log("Failed to send error notification:", notificationError),
        );
        throw error;
    } finally {
        try {
            device?.disconnect();
        } catch (error: unknown) {
            console.log("Error disconnecting from local Tuya device:", error);
        }
    }

    try {
        await sendNotification(
            status ? "Solar Heater Activated" : "Solar Heater Deactivated",
            status
                ? "The solar heater has been switched ON via the local network — solar gain is insufficient today."
                : "The solar heater has been switched OFF via the local network — solar gain is sufficient today.",
        );
    } catch (error: unknown) {
        console.log("Error sending notification:", error);
    }
}
