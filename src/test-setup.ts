// Keep the test suite deterministic: provider env gates must not leak in from a developer's
// .env.local (which would trigger live network calls). Individual tests opt into providers
// by injecting them directly.
for (const key of [
  'WEATHER_PROVIDER',
  'GEOCODING_PROVIDER',
  'AIR_QUALITY_PROVIDER',
  'FLOOD_PROVIDER',
  'RADIOACTIVITY_PROVIDER',
  'WATER_POLLUTION_PROVIDER',
  'RADON_PROVIDER',
  'RISK_WEIGHTS',
  'CDSE_ACCESS_TOKEN',
  'CDSE_CLIENT_ID',
  'CDSE_CLIENT_SECRET',
  'WORLDPOP_ENABLED',
  'WORLDPOP_API_KEY',
  'DGT_ROAD_CLOSURES_ENABLED',
  'COHERE_API_KEY',
  'JEV_AI_ENABLED',
  'JEV_API_KEY',
]) {
  delete process.env[key]
}
