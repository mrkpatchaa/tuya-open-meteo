// ---------------------------------------------------------------------------
// score.ts — score-only entry point.
//
// Prints exactly one JSON line on stdout:
//   {"score":0.62,"threshold":0.5,"needsHeater":false,"components":{...},"raw":{...}}
// Every log goes to stderr. It sends no Telegram message and never switches
// the relay (unlike index.ts). Used by HomeOS Maison at a pinned commit:
//   node --import tsx score.ts
//
// Env: LATITUDE, LONGITUDE (required), SOLAR_SCORE_THRESHOLD (optional, 0–1).
// Exit codes: 0 ok · 1 score unavailable or error · 2 bad or missing env.
// ---------------------------------------------------------------------------
import { pathToFileURL } from "node:url";
import { THRESHOLD, getSolarScore, type SolarScore } from "./solar";

type Env = Record<string, string | undefined>;
export type EnvCheck = { ok: true } | { ok: false; reason: string };

function checkNumber(env: Env, name: string, min: number, max: number, required: boolean): string | null {
    const value = env[name];
    if (value === undefined) return required ? `${name} is required` : null;
    if (value.trim() === "") return `${name} is empty`;
    const n = Number(value);
    if (!Number.isFinite(n)) return `${name} must be a number, got "${value}"`;
    if (n < min || n > max) return `${name} must be between ${min} and ${max}, got ${n}`;
    return null;
}

export function checkEnv(env: Env): EnvCheck {
    const reason =
        checkNumber(env, "LATITUDE", -90, 90, true) ??
        checkNumber(env, "LONGITUDE", -180, 180, true) ??
        checkNumber(env, "SOLAR_SCORE_THRESHOLD", 0, 1, false);
    return reason ? { ok: false, reason } : { ok: true };
}

export function scoreLine(result: SolarScore, threshold: number): string {
    return JSON.stringify({
        score: result.score,
        threshold,
        needsHeater: result.needsHeater,
        components: result.components,
        raw: result.raw,
    });
}

async function main(): Promise<number> {
    // solar.ts logs with console.log (stdout); keep stdout for the JSON line only.
    console.log = (...args: unknown[]) => console.error(...args);

    const check = checkEnv(process.env);
    if (!check.ok) {
        console.error(`score.ts: ${check.reason}`);
        return 2;
    }
    try {
        const result = await getSolarScore();
        if (!result) {
            console.error("score.ts: no solar score available");
            return 1;
        }
        process.stdout.write(scoreLine(result, THRESHOLD) + "\n");
        return 0;
    } catch (error) {
        console.error("score.ts: unexpected error:", error);
        return 1;
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exitCode = await main();
}
