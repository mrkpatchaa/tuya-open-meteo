// ---------------------------------------------------------------------------
// Weights must sum to 1.0
// ---------------------------------------------------------------------------
const WEIGHTS = {
    shortwave: 0.40, // W/m²  — actual solar energy at the surface (most direct)
    direct: 0.30, // W/m²  — direct beam only, most relevant for panel efficiency
    sunshine: 0.20, // s/hr  — independent measure of real sunshine
    cloudClear: 0.10, // %     — coarsest proxy, kept as a cross-check
};

// Approximate sunny-day averages for Morocco (9 am–4 pm window).
// Used to normalise each variable to a 0–1 scale.
const NORM = {
    shortwave: 700,  // W/m²
    direct: 600,  // W/m²
    sunshine: 3600, // s (full hour = completely sunny)
    cloudClear: 100,  // % clear sky
};

// Score threshold: below this value the heater turns ON.
// Configurable via SOLAR_SCORE_THRESHOLD env var (0–1).
export const THRESHOLD = Number(process.env.SOLAR_SCORE_THRESHOLD ?? 0.50);

export interface SolarScore {
    score: number;        // 0–1, higher = more solar gain
    needsHeater: boolean;
    components: {
        shortwave: number; // normalised 0–1
        direct: number;
        sunshine: number;
        cloudClear: number;
        precipPenalty: number;
    };
    raw: {
        shortwaveAvg: number; // W/m²
        directAvg: number; // W/m²
        sunshineAvg: number; // s/hr
        cloudAvg: number; // %
        precipTotal: number; // mm
    };
}

function calcPrecipPenalty(mm: number): number {
    if (mm > 2) return 0.50; // heavy rain
    if (mm > 0.5) return 0.75; // light rain
    return 1.0;                 // dry
}

export async function getSolarScore(): Promise<SolarScore | null> {
    const vars = "shortwave_radiation,direct_radiation,sunshine_duration,cloud_cover,precipitation";
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${process.env.LATITUDE}&longitude=${process.env.LONGITUDE}&hourly=${vars}&timezone=auto&forecast_days=1`;

    try {
        const response = await fetch(url);
        if (!response.ok) {
            console.log(`Open-Meteo HTTP error: ${response.status}`);
            return null;
        }

        const { hourly: h } = await response.json();

        // 9 am–4 pm local time (indices 9–16)
        const slice = (arr: number[]) => arr.slice(9, 16);
        const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
        const clamp = (v: number) => Math.min(1, Math.max(0, v));

        const shortwaveAvg = avg(slice(h.shortwave_radiation));
        const directAvg = avg(slice(h.direct_radiation));
        const sunshineAvg = avg(slice(h.sunshine_duration));
        const cloudAvg = avg(slice(h.cloud_cover));
        const precipTotal = slice(h.precipitation).reduce((a: number, b: number) => a + b, 0);

        const nShortwave = clamp(shortwaveAvg / NORM.shortwave);
        const nDirect = clamp(directAvg / NORM.direct);
        const nSunshine = clamp(sunshineAvg / NORM.sunshine);
        const nCloudClear = clamp((100 - cloudAvg) / NORM.cloudClear);
        const precipPenalty = calcPrecipPenalty(precipTotal);

        const score =
            (WEIGHTS.shortwave * nShortwave +
                WEIGHTS.direct * nDirect +
                WEIGHTS.sunshine * nSunshine +
                WEIGHTS.cloudClear * nCloudClear) * precipPenalty;

        return {
            score,
            needsHeater: score < THRESHOLD,
            components: { shortwave: nShortwave, direct: nDirect, sunshine: nSunshine, cloudClear: nCloudClear, precipPenalty },
            raw: { shortwaveAvg, directAvg, sunshineAvg, cloudAvg, precipTotal },
        };
    } catch (error) {
        console.log("Error fetching weather data:", error);
        return null;
    }
}
