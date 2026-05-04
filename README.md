# Solar Heater Control with Open-Meteo

Automatically switches a Tuya smart relay ON or OFF every day based on cloud cover forecast from [Open-Meteo](https://open-meteo.com). If daytime cloud cover (9 am – 4 pm) exceeds 75%, the solar heater is turned ON (solar gain is insufficient). Otherwise it is turned OFF (sunny day, solar panels are doing the work).

A notification email is sent after every run.

## How it runs

The script is scheduled via **GitHub Actions** at **17:00 Morocco time (16:00 UTC)** daily, so the forecast data is fully available for the current day. It can also be triggered manually from the Actions tab.

```
.github/workflows/solar.yml  →  runs index.ts  →  Open-Meteo API + Tuya Cloud API
```

## Setup

### 1. Tuya Cloud credentials

1. Create a free account at [iot.tuya.com](https://iot.tuya.com)
2. **Cloud → Create Cloud Project** — pick *Smart Home* scenario, *Europe* region
3. Under **Devices → Link Tuya App Account**, scan the QR code with your Tuya / Smart Life app to link your device
4. Copy the **Access ID** and **Access Secret** from the project overview page

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
| `SMTP_HOST/PORT/USER/PASS` | SMTP credentials for notification emails |
| `EMAIL_FROM` / `EMAIL_TO` | Sender and recipient addresses |
| `MAIL_SUBJECT_PREFIX` | *(optional)* Prefix added to every email subject |

### 3. Push secrets to GitHub

Requires the [GitHub CLI](https://cli.github.com):

```bash
gh secret set --env-file .env
```

Verify with `gh secret list`.

### 4. Run locally

```bash
npm install
npm start
```

## Notes

- The device's switch DP code is auto-discovered on every run by querying `/v1.0/devices/{id}/functions`. Set `TUYA_SWITCH_CODE` in your secrets to skip discovery and hard-pin a specific code.
- The Tuya IoT Platform free trial expires periodically — renew it at [iot.tuya.com](https://iot.tuya.com) under your project's subscription settings.
- Morocco uses UTC+1 year-round, so 16:00 UTC = 17:00 local time.
