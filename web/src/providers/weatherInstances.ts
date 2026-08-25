import { OpenWeatherMapProvider, OpenMeteoProvider } from "./WeatherProvider";

// Single shared instances — both MapCanvas (raster overlay) and
// App/WeatherControls (forecast panel, legend list) need the same provider,
// and OpenMeteoProvider/OpenWeatherMapProvider hold no per-consumer state,
// so one module-level instance of each avoids pointless duplication.
export const weatherMapProvider = new OpenWeatherMapProvider();
export const weatherForecastProvider = new OpenMeteoProvider();
