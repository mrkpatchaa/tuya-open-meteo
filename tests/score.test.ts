import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkEnv, scoreLine } from "../score.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const validEnv = { LATITUDE: "33.5", LONGITUDE: "-7.6" };

test("checkEnv rejects a missing LATITUDE", () => {
    const r = checkEnv({ LONGITUDE: "-7.6" });
    assert.equal(r.ok, false);
    assert.match((r as { reason: string }).reason, /LATITUDE/);
});

test("checkEnv rejects a non-number LONGITUDE", () => {
    const r = checkEnv({ LATITUDE: "33.5", LONGITUDE: "abc" });
    assert.equal(r.ok, false);
    assert.match((r as { reason: string }).reason, /LONGITUDE/);
});

test("checkEnv rejects a threshold above 1", () => {
    const r = checkEnv({ ...validEnv, SOLAR_SCORE_THRESHOLD: "1.5" });
    assert.equal(r.ok, false);
    assert.match((r as { reason: string }).reason, /SOLAR_SCORE_THRESHOLD/);
});

test("checkEnv accepts a valid env, with or without threshold", () => {
    assert.deepEqual(checkEnv(validEnv), { ok: true });
    assert.deepEqual(checkEnv({ ...validEnv, SOLAR_SCORE_THRESHOLD: "0.5" }), { ok: true });
});

test("scoreLine gives one line of valid JSON", () => {
    const components = { shortwave: 1, direct: 0.5, sunshine: 0.5, cloudClear: 1, precipPenalty: 1 };
    const line = scoreLine(
        {
            score: 0.7,
            needsHeater: false,
            components,
            raw: { shortwaveAvg: 1, directAvg: 1, sunshineAvg: 1, cloudAvg: 1, precipTotal: 0 },
        },
        0.5,
    );
    assert.ok(!line.includes("\n"));
    const parsed = JSON.parse(line);
    assert.equal(parsed.score, 0.7);
    assert.equal(parsed.threshold, 0.5);
    assert.equal(parsed.needsHeater, false);
    assert.deepEqual(parsed.components, components);
});

function stubUrl(body: string): string {
    const code = `globalThis.fetch = async () => ${body};`;
    return "data:text/javascript," + encodeURIComponent(code);
}

function runScore(stub: string, env: Record<string, string>) {
    return spawnSync(process.execPath, ["--import", "tsx", "--import", stubUrl(stub), "score.ts"], {
        cwd: repoRoot,
        env: { PATH: process.env.PATH ?? "", ...env },
        encoding: "utf8",
    });
}

const day = (v: number) => Array.from({ length: 24 }, () => v);
const okBody = `new Response(JSON.stringify({ hourly: {
    shortwave_radiation: ${JSON.stringify(day(500))},
    direct_radiation: ${JSON.stringify(day(400))},
    sunshine_duration: ${JSON.stringify(day(3000))},
    cloud_cover: ${JSON.stringify(day(20))},
    precipitation: ${JSON.stringify(day(0))},
} }))`;

test("score.ts prints one JSON line on success", () => {
    const r = runScore(okBody, { ...validEnv, SOLAR_SCORE_THRESHOLD: "0.5" });
    assert.equal(r.status, 0, r.stderr);
    const lines = r.stdout.split("\n").filter((l) => l.trim() !== "");
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]);
    assert.equal(typeof parsed.score, "number");
    assert.ok(parsed.score >= 0 && parsed.score <= 1);
    assert.equal(parsed.threshold, 0.5);
    assert.equal(typeof parsed.needsHeater, "boolean");
});

test("score.ts sends solar.ts logs to stderr and exits 1 on HTTP failure", () => {
    const r = runScore(`new Response('', { status: 500 })`, validEnv);
    assert.notEqual(r.status, 0);
    assert.equal(r.stdout, "");
    assert.notEqual(r.stderr, "");
    assert.match(r.stderr, /Open-Meteo HTTP error/);
});

test("score.ts exits 2 with empty stdout when LATITUDE is missing", () => {
    const r = runScore(okBody, { LONGITUDE: "-7.6" });
    assert.equal(r.status, 2);
    assert.equal(r.stdout, "");
});
