### Web app to assess forest-fire risk

### Description
- The possibility of a forest fire near my location is high. I want an app that estimates fire risk from location, terrain, wind, nearby population, season, and other relevant environmental factors.
- The app should explain the risk score and its contributing factors instead of presenting an unexplained AI prediction.
- The dashboard should prioritize transparent inputs and risk factors over a fire-spread simulation or escape guidance.

### Tools
- Use Google Maps or another map provider for location selection and map rendering.
- Use reliable weather, elevation, land-cover, and population data providers when available.
- Cohere or Grok may generate a plain-language explanation of the score, but they must not be the authoritative source of the score or emergency instructions.
- Manual local-context inputs are acceptable until authoritative local data providers are available.

### Technologies
- Use React with TanStack Start and TanStack Router instead of Next.js.
- Deploy the web app on Vercel.
- Keep provider keys and data fetching on the server side; the browser should receive only the data required for the current view.
- Use TypeScript throughout the application.

### Solution

#### MVP goal

Build a focused risk-assessment dashboard for one selected location. A user can choose a location, review the available environmental inputs, and receive a transparent risk score.

#### User flow

1. The user selects a location on a map or allows browser geolocation.
2. The server retrieves the available weather, elevation, land-cover, and population context for that location.
3. The application normalizes the inputs and calculates a reproducible risk score from documented weighted factors.
4. The dashboard shows the risk level, score confidence, timestamp, data sources, missing inputs, and the factors increasing or reducing risk.
5. The user can provide optional manual estimates for local festival/event pressure and roadside ditch maintenance.
6. The interface links to official emergency guidance for real incidents.

#### Risk model

The first version should use a deterministic, versioned scoring model rather than an opaque AI model. Each factor is normalized to a common range, weighted, and combined into a score from 0 to 100. The initial factors are:

- Current and forecast weather: temperature, humidity, precipitation, and wind speed/direction.
- Terrain: elevation, slope, and aspect.
- Fuel and land cover: vegetation type and dryness proxy.
- Season and recent weather history.
- Population and buildings in the surrounding area, used for exposure rather than ignition probability.
- Local festivals/events, used as a manual ignition and activity-pressure estimate.
- Roadside ditch maintenance, used as a manual fuel-reduction estimate.

The score must include a confidence indicator. Missing or stale data lowers confidence instead of silently being treated as safe. The model version and input timestamp should be visible so results can be reproduced.

#### Architecture

- TanStack Router defines the location and risk-dashboard routes.
- TanStack Start provides server functions for geolocation-context retrieval and score calculation.
- A provider adapter layer keeps map, weather, elevation, and other external APIs replaceable without coupling the UI to them.
- A pure scoring module accepts normalized inputs and returns the score, factor breakdown, confidence, and model version.
- The UI provides loading, unavailable-data, stale-data, rate-limit, and provider-error states.

#### Safety and privacy

- Show a prominent notice that the product is an informational estimate, not an official warning, prediction, or evacuation order.
- Direct users to local emergency services and official fire authorities during an active emergency.
- Ask for geolocation permission only when needed and avoid storing precise locations by default.
- Do not expose provider API keys in client code, and validate all external responses before scoring them.

#### Delivery phases

1. **MVP:** location selection, mocked/provider-backed environmental inputs, deterministic score, explanation panel, and manual local-context inputs.
2. **Data hardening:** real provider integrations, caching, freshness tracking, source attribution, validation, and observability.
3. **AI assistance:** optional Cohere/Grok explanations and scenario summaries, constrained to verified inputs and never used as the score authority.
4. **Operational features:** official alerts, historical comparisons, user-defined locations, and verified evacuation information only after the data and safety model are validated.

#### Local context and escape route
- Manual local-context inputs are temporary estimates and must be labeled as user-provided until official municipal or road-authority data is integrated.
- Do not recommend a "safest" escape route from the fire-risk score alone. Road and country-crossing guidance requires an official routing, closure, evacuation, or emergency-data source. Until that source exists, show a clear unavailable state and direct users to local emergency services and fire authorities during an active emergency.
