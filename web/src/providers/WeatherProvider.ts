import type { AttributionEntry, LngLat } from "./types";
import { withTimeout } from "../net/fetchTimeout";

const REQUEST_TIMEOUT_MS = 15000;

// ---------------------------------------------------------------------------
// Raster weather map overlays — visual tile layers drawn over the map
// (temperature, precipitation, wind, clouds, pressure).
// ---------------------------------------------------------------------------

export type WeatherMapLayerId = "temp_new" | "precipitation_new" | "clouds_new" | "wind_new" | "pressure_new";

export interface WeatherMapLayerDef {
  id: WeatherMapLayerId;
  label: string;
  /** Short, honest description of what the layer shows — deliberately not a
   * precise value-to-color legend: OpenWeatherMap does not publish exact
   * color-stop values for these tiles anywhere we could verify, and
   * inventing specific hex/value pairs would risk showing a legend that
   * doesn't actually match the rendered tile colors. */
  legendHint: string;
}

export interface WeatherMapProvider {
  readonly name: string;
  readonly attribution: AttributionEntry;
  readonly requiresApiKey: boolean;
  readonly layers: WeatherMapLayerDef[];
  getTileUrlTemplate(layer: WeatherMapLayerId, apiKey: string): string;
  /** OpenWeatherMap's Weather Maps 1.0 tiles are a single current snapshot
   * per layer, refreshed server-side every 10-15 minutes — there is no
   * forecast/historical time parameter on the free tier. Callers must not
   * present a time control for this provider (see WeatherForecastProvider
   * for real forecast data instead). */
  readonly refreshIntervalMs: number;
}

/**
 * OpenWeatherMap Weather Maps 1.0 — free tile layers, requires a free API
 * key (VITE_OWM_API_KEY). URL scheme confirmed against OWM's published API
 * docs: tile.openweathermap.org/map/{layer}/{z}/{x}/{y}.png?appid={key}.
 * These tiles are NOT routed through the app's persistent tile cache
 * (see MapCanvas) because they represent current, time-varying conditions —
 * caching them indefinitely would risk silently showing stale weather as
 * current.
 */
export class OpenWeatherMapProvider implements WeatherMapProvider {
  readonly name = "OpenWeatherMap";
  readonly requiresApiKey = true;
  readonly refreshIntervalMs = 10 * 60 * 1000;
  readonly attribution: AttributionEntry = {
    html: 'Weather: <a href="https://openweathermap.org" target="_blank" rel="noreferrer">OpenWeatherMap</a>',
  };
  readonly layers: WeatherMapLayerDef[] = [
    { id: "precipitation_new", label: "Precipitation", legendHint: "Blue/green = light, purple/red = heavy" },
    { id: "temp_new", label: "Temperature", legendHint: "Blue = cold, yellow/red = hot" },
    { id: "wind_new", label: "Wind", legendHint: "Blue = calm, red = strong wind" },
    { id: "clouds_new", label: "Cloud cover", legendHint: "White/grey = cloudier" },
    { id: "pressure_new", label: "Pressure", legendHint: "Blue = low pressure, red = high pressure" },
  ];

  getTileUrlTemplate(layer: WeatherMapLayerId, apiKey: string): string {
    return `https://tile.openweathermap.org/map/${layer}/{z}/{x}/{y}.png?appid=${apiKey}`;
  }
}

// ---------------------------------------------------------------------------
// Point/time forecast data — numeric conditions + a real hourly time control.
// ---------------------------------------------------------------------------

export interface WeatherHour {
  timeIso: string;
  temperatureC: number | null;
  precipitationMm: number | null;
  rainMm: number | null;
  snowfallCm: number | null;
  cloudCoverPercent: number | null;
  windSpeedKmh: number | null;
  windDirectionDeg: number | null;
  freezingLevelM: number | null;
}

export interface WeatherForecast {
  point: LngLat;
  timezone: string;
  generatedAt: number;
  hours: WeatherHour[];
}

export interface WeatherForecastProvider {
  readonly name: string;
  readonly attribution: AttributionEntry;
  readonly requiresApiKey: boolean;
  getForecast(point: LngLat, signal?: AbortSignal): Promise<WeatherForecast>;
}

interface OpenMeteoResponse {
  timezone: string;
  hourly: {
    time: string[];
    temperature_2m: (number | null)[];
    precipitation: (number | null)[];
    rain: (number | null)[];
    snowfall: (number | null)[];
    cloud_cover: (number | null)[];
    wind_speed_10m: (number | null)[];
    wind_direction_10m: (number | null)[];
    freezing_level_height: (number | null)[];
  };
}

const FORECAST_HOURS = 48;

/**
 * Open-Meteo — free, keyless, no signup, generous fair-use limits (no
 * published hard cap for non-commercial personal use). Confirmed live via a
 * direct test call: all requested hourly variables (temperature_2m,
 * precipitation, rain, snowfall, cloud_cover, wind_speed_10m,
 * wind_direction_10m, freezing_level_height) are real and returned.
 * Attribution required: "Weather data by Open-Meteo.com" (CC BY 4.0).
 */
export class OpenMeteoProvider implements WeatherForecastProvider {
  readonly name = "Open-Meteo";
  readonly requiresApiKey = false;
  readonly attribution: AttributionEntry = {
    html: 'Forecast: <a href="https://open-meteo.com" target="_blank" rel="noreferrer">Open-Meteo.com</a> (<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>)',
  };

  async getForecast(point: LngLat, signal?: AbortSignal): Promise<WeatherForecast> {
    const params = new URLSearchParams({
      latitude: point.lat.toFixed(4),
      longitude: point.lng.toFixed(4),
      hourly: [
        "temperature_2m",
        "precipitation",
        "rain",
        "snowfall",
        "cloud_cover",
        "wind_speed_10m",
        "wind_direction_10m",
        "freezing_level_height",
      ].join(","),
      forecast_days: "3",
      timezone: "auto",
    });
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`, {
      signal: withTimeout(signal, REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const rateLimited = res.status === 429 ? " (rate limited — try again shortly)" : "";
      throw new Error(`Open-Meteo request failed: ${res.status}${rateLimited} ${body.slice(0, 200)}`);
    }
    const data = (await res.json()) as OpenMeteoResponse;
    const h = data.hourly;
    const count = Math.min(h.time.length, FORECAST_HOURS);
    const hours: WeatherHour[] = [];
    for (let i = 0; i < count; i++) {
      hours.push({
        timeIso: h.time[i],
        temperatureC: h.temperature_2m[i] ?? null,
        precipitationMm: h.precipitation[i] ?? null,
        rainMm: h.rain[i] ?? null,
        snowfallCm: h.snowfall[i] ?? null,
        cloudCoverPercent: h.cloud_cover[i] ?? null,
        windSpeedKmh: h.wind_speed_10m[i] ?? null,
        windDirectionDeg: h.wind_direction_10m[i] ?? null,
        freezingLevelM: h.freezing_level_height[i] ?? null,
      });
    }
    return { point, timezone: data.timezone, generatedAt: Date.now(), hours };
  }
}
