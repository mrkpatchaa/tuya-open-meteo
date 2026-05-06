import "./logger";
import { sendNotification } from "./notify";
import { getSolarScore, THRESHOLD } from "./solar";
import { setDeviceStatus } from "./tuya";
import { askTelegram } from "./telegram";

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const solar = await getSolarScore();

if (!solar) {
  await sendNotification(
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
