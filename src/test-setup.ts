// Keep the test suite deterministic: provider env gates must not leak in from a developer's
// .env.local (which would trigger live network calls). Individual tests opt into providers
// by injecting them directly.
for (const key of [
  'WEATHER_PROVIDER',
  'AIR_QUALITY_PROVIDER',
  'FLOOD_PROVIDER',
  'RADIOACTIVITY_PROVIDER',
  'WATER_POLLUTION_PROVIDER',
  'RADON_PROVIDER',
  'RISK_WEIGHTS',
]) {
  delete process.env[key]
}
