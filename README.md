# Solar Heater Control with Open-Meteo

Automatically switches a Tuya smart relay ON or OFF every day based on a **weighted solar sufficiency score** computed from four Open-Meteo forecast variables. If the score falls below a configurable threshold (default 50%), the solar heater is turned ON (solar gain is insufficient). Otherwise it is turned OFF (sunny enough for the panels).

A notification email including a full score breakdown is sent after every run. Optionally, a **Telegram bot** sends the score as an interactive message so you can override the decision before it executes.

## How the score works

Four variables are fetched for the **9 am – 4 pm** local window and combined into a single score (0–1, higher = more solar gain):

| Variable | Weight | Unit | Why |
|---|---|---|---|
| `shortwave_radiation` | **40%** | W/m² | Actual solar energy at the surface — most direct physical measure |
| `direct_radiation` | **30%** | W/m² | Direct beam only — most relevant for panel efficiency |
| `sunshine_duration` | **20%** | s/hr | Independent measure of real sunshine |
| `cloud_cover` | **10%** | % | Coarsest proxy, kept as a cross-check |

**Precipitation** is applied as a multiplicative penalty on the final score:
- > 2 mm → ×0.50
- 0.5 – 2 mm → ×0.75
- dry → ×1.0 (no change)

Each variable is normalised against a sunny-day reference for Morocco before weighting. The final score and decision are logged and included in the notification email:

```
─── Solar score breakdown (9 am–4 pm average) ───
  Shortwave radiation : 312 W/m²  → 44.6% (weight 40%)
  Direct radiation    : 198 W/m²  → 33.0% (weight 30%)
  Sunshine duration   : 2180 s/hr → 60.6% (weight 20%)
  Cloud-free sky      : 55%       → 55.0% (weight 10%)
  Precipitation total : 0.0 mm    → penalty ×1
  ──────────────────────────────────────────────
  Final score         : 44.9%  (threshold: 50.0%)
  Decision            : heater ON
```

## How it runs

Scheduled via **GitHub Actions** at **17:00 Morocco time (16:00 UTC)** daily, so the forecast is fully resolved for the current day. Can also be triggered manually from the Actions tab.

```
.github/workflows/solar.yml  →  runs index.ts  →  Open-Meteo API + Tuya Cloud API
                                                  ↕ (optional)
                                              Telegram bot
```

When Telegram is configured, the workflow pauses waiting for your tap (default **10 minutes**, configurable via `TELEGRAM_TIMEOUT_MIN`). If you don't respond in time, the automatic decision executes.

## Setup

### 1. Tuya Cloud credentials

1. Create a free account at [iot.tuya.com](https://iot.tuya.com)
2. **Cloud → Create Cloud Project** — pick *Smart Home* scenario, *Europe* region
3. Under **Devices → Link Tuya App Account**, scan the QR code with your Tuya / Smart Life app to link your device
4. Copy the **Access ID** and **Access Secret** from the project overview page

> The free trial expires periodically — renew it under your project's subscription settings.

### 2. Configure environment variables

Copy `.env.example` to `.env` and fill in all values:

| Variable | Description |
|---|---|
| `TUYA_ACCESS_ID` | Tuya Cloud project Access ID |
| `TUYA_ACCESS_SECRET` | Tuya Cloud project Access Secret |
| `TUYA_DEVICE_ID` | Device ID (visible in the Tuya app or IoT console) |
| `TUYA_BASE_URL` | Regional endpoint — `https://openapi.tuyaeu.com` for Europe/Africa |
| `TUYA_SWITCH_CODE` | *(optional)* Force a specific DP code (auto-discovered if omitted) |
| `LATITUDE` / `LONGITUDE` | Location for the weather forecast |
| `SOLAR_SCORE_THRESHOLD` | *(optional)* Score below which the heater turns ON, default `0.50` |
| `SMTP_HOST/PORT/USER/PASS` | SMTP credentials for notification emails |
| `EMAIL_FROM` / `EMAIL_TO` | Sender and recipient addresses |
| `MAIL_SUBJECT_PREFIX` | *(optional)* Prefix added to every email subject |
| `TELEGRAM_BOT_TOKEN` | *(optional)* Bot token from @BotFather — enables interactive overrides |
| `TELEGRAM_CHAT_ID` | *(optional)* Your personal chat ID (see Telegram setup below) |
| `TELEGRAM_TIMEOUT_MIN` | *(optional)* Minutes to wait for a Telegram response before auto-executing, default `10` |

### 3. Push secrets to GitHub

Requires the [GitHub CLI](https://cli.github.com):

```bash
gh secret set --env-file .env
```

Verify with `gh secret list`.

### 4. Run locally

```bash
npm install
cp .env.example .env
# Configure variables
npm run dev
```

### 5. Telegram bot setup (optional)

The Telegram integration is entirely optional. When both `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are set, the workflow sends you a message like this before acting:

```
☀️ Solar Heater — Daily Decision

Shortwave : 312 W/m²  → 44.6% (40%)
Direct    : 198 W/m²  → 33.0% (30%)
Sunshine  : 2180 s/hr → 60.6% (20%)
Cloud-free: 55%       → 55.0% (10%)
Rain      : 0.0 mm    → ×1
─────────────────────────────────
Score     : 44.9%  (threshold: 50.0%)
Auto      : 🔥 ON

Override or confirm below (auto-executes in 10 min):
[ 🔥 Turn ON ]  [ ✅ Turn OFF ]  [ 🤖 Auto ]
```

**Step 1 — Create a bot**

1. Open Telegram and start a chat with [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow the prompts
3. Copy the **HTTP API token** it gives you → `TELEGRAM_BOT_TOKEN`

**Step 2 — Get your chat ID**

1. Start a conversation with your new bot (send it any message)
2. Open this URL in your browser (replace `<TOKEN>` with your token):
   ```
   https://api.telegram.org/bot<TOKEN>/getUpdates
   ```
3. Find `"chat":{"id": 123456789, ...}` in the response → that number is your `TELEGRAM_CHAT_ID`

> Alternatively, forward any message to [@userinfobot](https://t.me/userinfobot) — it replies with your chat ID instantly.

**Step 3 — Add the secrets**

Add `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` to your `.env`, then push to GitHub:

```bash
gh secret set --env-file .env
```

If you skip this setup, the script runs fully automatically without any Telegram interaction.

## Tuning

- **Threshold**: set `SOLAR_SCORE_THRESHOLD` (0–1) to make the heater more or less aggressive. Raise it to turn ON more often; lower it to require worse conditions before switching ON.
- **DP code**: set `TUYA_SWITCH_CODE` to skip the auto-discovery request on every run once you know the correct code.
