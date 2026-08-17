### Web app to assess forest-fire risk and simulate spread

### Description
- The possibility of a forest fire near my location is high. I want an app that estimates fire risk from location, terrain, wind, nearby population, season, and other relevant environmental factors.
- The app should explain the risk score and its contributing factors instead of presenting an unexplained AI prediction.
- It may include a 2D simulation canvas showing a hypothetical fire's spread and possible escape directions. This simulation must be clearly labeled as an approximation, not an emergency evacuation service.

### Tools
- Use Google Maps or another map provider for location selection and map rendering.
- Use reliable weather, elevation, land-cover, and population data providers when available.
- Cohere or Grok may generate a plain-language explanation of the score, but they must not be the authoritative source of the score or emergency instructions.
- Use a browser-native Canvas or SVG implementation for the first simulation; add a specialized visualization library only when the native implementation is insufficient.

### Technologies
- Use React with TanStack Start and TanStack Router instead of Next.js.
- Deploy the web app on Vercel.
- Keep provider keys and data fetching on the server side; the browser should receive only the data required for the current view.
- Use TypeScript throughout the application.

### Solution

#### MVP goal

Build a focused risk-assessment dashboard for one selected location. A user can choose a location, review the available environmental inputs, receive a transparent risk score, and run a bounded visual simulation.

#### User flow

1. The user selects a location on a map or allows browser geolocation.
2. The server retrieves the available weather, elevation, land-cover, and population context for that location.
3. The application normalizes the inputs and calculates a reproducible risk score from documented weighted factors.
4. The dashboard shows the risk level, score confidence, timestamp, data sources, missing inputs, and the factors increasing or reducing risk.
5. The user can start a hypothetical 2D spread simulation using the current wind, terrain, vegetation, and moisture assumptions.
6. The interface shows estimated spread direction and time steps, while linking to official emergency guidance for real incidents.

#### Risk model

The first version should use a deterministic, versioned scoring model rather than an opaque AI model. Each factor is normalized to a common range, weighted, and combined into a score from 0 to 100. The initial factors are:

- Current and forecast weather: temperature, humidity, precipitation, and wind speed/direction.
- Terrain: elevation, slope, and aspect.
- Fuel and land cover: vegetation type and dryness proxy.
- Season and recent weather history.
- Population and buildings in the surrounding area, used for exposure rather than ignition probability.

The score must include a confidence indicator. Missing or stale data lowers confidence instead of silently being treated as safe. The model version and input timestamp should be visible so results can be reproduced.

#### Simulation

Use a small grid-based simulation rendered with Canvas or SVG. Wind biases spread between neighboring cells; slope, vegetation, and moisture adjust the spread probability. The MVP should optimize for explaining the direction and assumptions, not for forecasting an actual fire. Escape routes should not be presented as authoritative unless they come from an official routing or emergency-data source.

#### Architecture

- TanStack Router defines the location and risk-dashboard routes.
- TanStack Start provides server functions for geolocation-context retrieval and score calculation.
- A provider adapter layer keeps map, weather, elevation, and other external APIs replaceable without coupling the UI to them.
- A pure scoring module accepts normalized inputs and returns the score, factor breakdown, confidence, and model version.
- A client-side simulation module runs the visualization without blocking server requests.
- The UI provides loading, unavailable-data, stale-data, rate-limit, and provider-error states.

#### Safety and privacy

- Show a prominent notice that the product is an informational estimate, not an official warning, prediction, or evacuation order.
- Direct users to local emergency services and official fire authorities during an active emergency.
- Ask for geolocation permission only when needed and avoid storing precise locations by default.
- Do not expose provider API keys in client code, and validate all external responses before scoring them.

#### Delivery phases

1. **MVP:** location selection, mocked/provider-backed environmental inputs, deterministic score, explanation panel, and basic simulation.
2. **Data hardening:** real provider integrations, caching, freshness tracking, source attribution, validation, and observability.
3. **AI assistance:** optional Cohere/Grok explanations and scenario summaries, constrained to verified inputs and never used as the score authority.
4. **Operational features:** official alerts, historical comparisons, user-defined locations, and verified evacuation information only after the data and safety model are validated.

#### Simulation and escape route
- Improve the simulation as an explanatory scenario, not as a claimed reconstruction or forecast of a real fire. It should use the verified context inputs already available, show the assumptions and uncertainty, and remain clearly bounded.
- Do not recommend a "safest" escape route from the fire-risk score alone. Road and country-crossing guidance requires an official routing, closure, evacuation, or emergency-data source. Until that source exists, show a clear unavailable state and direct users to local emergency services and fire authorities during an active emergency.
- Candidate ideas for a later phase: display wind and slope vectors, expose a time-step and scenario summary, show confidence/data freshness beside the simulation, and add an official-route adapter with source timestamp, closures, and an explicit disclaimer.
