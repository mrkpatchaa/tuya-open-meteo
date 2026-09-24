import { strict as assert } from "node:assert";
import { test } from "node:test";
import { getTuyaMode } from "../tuya.js";

test("defaults to cloud mode when TUYA_MODE is not set", () => {
    assert.equal(getTuyaMode({}), "cloud");
});

test("selects local mode from TUYA_MODE", () => {
    assert.equal(getTuyaMode({ TUYA_MODE: "local" }), "local");
});

test("rejects an unknown Tuya mode", () => {
    assert.throws(
        () => getTuyaMode({ TUYA_MODE: "lan" }),
        /TUYA_MODE must be "cloud" or "local"/,
    );
});
