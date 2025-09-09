
# Solar Heater Control with weather monitoring from Open Meteo

Configured to run everyday at 4 pm, via cron
```bash
0 16 * * * node --env-file=tuya-open-meteo/.env tuya-open-meteo/index.ts
```

## Tuya Api setup

https://github.com/codetheweb/tuyapi

https://github.com/codetheweb/tuyapi/blob/master/docs/SETUP.md
