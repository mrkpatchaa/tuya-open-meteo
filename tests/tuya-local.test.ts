import { strict as assert } from "node:assert";
import { test } from "node:test";
import { setLocalDeviceStatus } from "../tuya-local.js";

type DeviceListener = (error: Error) => void;

function restoreEnv(name: string, value: string | undefined) {
    if (value === undefined) {
        delete process.env[name];
    } else {
        process.env[name] = value;
    }
}

class FakeDevice {
    readonly calls: string[] = [];
    connected = false;
    private readonly listeners = new Map<string, DeviceListener[]>();

    on(event: string, listener: DeviceListener) {
        const listeners = this.listeners.get(event) ?? [];
        listeners.push(listener);
        this.listeners.set(event, listeners);
        return this;
    }

    async find() {
        this.calls.push("find");
        return true;
    }

    async connect() {
        this.calls.push("connect");
        this.connected = true;
        return true;
    }

    async set(options: { dps: number; set: boolean }) {
        this.calls.push(`set:${options.dps}:${options.set}`);
        return { dps: { [options.dps.toString()]: options.set } };
    }

    isConnected() {
        return this.connected;
    }

    disconnect() {
        this.calls.push("disconnect");
        this.connected = false;
    }
}

test("finds, connects, and sets the default local DPS", async () => {
    const device = new FakeDevice();
    const previousId = process.env.TUYA_DEVICE_ID;
    const previousKey = process.env.TUYA_DEVICE_KEY;
    process.env.TUYA_DEVICE_ID = "device-id";
    process.env.TUYA_DEVICE_KEY = "1234567890abcdef";

    try {
        await setLocalDeviceStatus(true, () => device);
    } finally {
        restoreEnv("TUYA_DEVICE_ID", previousId);
        restoreEnv("TUYA_DEVICE_KEY", previousKey);
    }

    assert.deepEqual(device.calls, ["find", "connect", "set:1:true", "disconnect"]);
});

test("disconnects and rejects when the local set command fails", async () => {
    const device = new FakeDevice();
    device.set = async () => {
        device.calls.push("set:failed");
        throw new Error("command failed");
    };
    const previousId = process.env.TUYA_DEVICE_ID;
    const previousKey = process.env.TUYA_DEVICE_KEY;
    process.env.TUYA_DEVICE_ID = "device-id";
    process.env.TUYA_DEVICE_KEY = "1234567890abcdef";

    try {
        await assert.rejects(
            setLocalDeviceStatus(false, () => device),
            /command failed/,
        );
    } finally {
        restoreEnv("TUYA_DEVICE_ID", previousId);
        restoreEnv("TUYA_DEVICE_KEY", previousKey);
    }

    assert.equal(device.isConnected(), false);
    assert.equal(device.calls.at(-1), "disconnect");
});
