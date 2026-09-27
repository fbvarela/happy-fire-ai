# NASA Hazard Data Integration Specification

## Purpose

This feature integrates NASA's public disaster and fire monitoring APIs — FIRMS (Fire Information for Resource Management System) and the NASA DISASTER Hub (ArcGIS REST) — to retrieve near-real-time and historical hazard data: active fire detections, fire perimeters, and disaster event layers. The data powers **map overlays and advisory information** in the multi-hazard dashboard.

**Architectural rule (unchanged):** NASA data is observational/display data. It never feeds `src/domain/` scorers and never alters the deterministic risk score, factors, confidence arithmetic beyond documented confidence rules, safety notice, or emergency guidance.

## Requirements

### Requirement: The system SHALL gate NASA providers behind environment variables

The system SHALL enable each NASA provider only when its environment variable is set, following the existing provider convention in `src/server/hazard-environment.ts`. Unset/disabled env values resolve to the deterministic mock overlay data, always labelled as mock.

| Variable | Values | Effect |
|---|---|---|
| `FIRMS_MAP_KEY` | string | Presence enables the FIRMS provider; the key is a server-side secret never exposed to the client |
| `FIRMS_SOURCE` | FIRMS SOURCE id (default `VIIRS_SNPP_NOAA20_375m_NRT`) | Satellite product to query |
| `FIRMS_MIN_CONFIDENCE` | `low` \| `nominal` \| `high` | Optional minimum-confidence filter (default: show all) |
| `FIRMS_DAY_RANGE` | 1–7 (default 2) | Detection lookback window in days |

| `NASA_DISASTER_ENABLED` | `true` | Enables the DISASTER Hub provider for event/perimeter layers |

#### Scenario: FIRMS enabled via env

- GIVEN `FIRMS_MAP_KEY` is set
- WHEN the server resolves NASA providers
- THEN the system SHALL construct the FIRMS provider and use live API data

#### Scenario: FIRMS disabled or unset

- GIVEN `FIRMS_MAP_KEY` is unset
- WHEN the user views the dashboard
- THEN the system SHALL serve deterministic mock overlay data labelled as mock, with a warning indicating live data is not active

#### Scenario: MAP_KEY stays server-only

- GIVEN any provider configuration
- WHEN the client renders the dashboard
- THEN the system SHALL never expose `FIRMS_MAP_KEY` or its value to the client bundle; all FIRMS requests originate server-side

### Requirement: The system SHALL retrieve active wildfire detections from NASA FIRMS

The system SHALL query the NASA FIRMS Area API (`https://firms.modaps.eosdis.nasa.gov/api/area/csv/{MAP_KEY}/{SOURCE}/{west},{south},{east},{north}/{dayRange}/{date}`) for active fire detections (VIIRS S-NPP/NOAA-20, MODIS) within the requested bounding box, returning per-detection: latitude, longitude, brightness temperature (K), confidence, scan/track, acquisition date/time, day/night flag, and satellite source.

#### Scenario: FIRMS API returns active fires for a wildfire-prone region

- GIVEN the user is viewing a region within known wildfire activity (e.g., California, Portugal, Greece)
- WHEN the system queries the FIRMS API for the visible map bounds
- THEN the system SHALL display active fire detection points on the map with brightness temperature and confidence indicators

#### Scenario: FIRMS API returns no detections

- GIVEN the user is viewing a region with no recent satellite fire detections
- WHEN the system queries the FIRMS API and receives an empty response
- THEN the system SHALL render the map without fire detection markers and show a "No active fires detected" status (an empty result is success, not an error)

#### Scenario: FIRMS API request fails

- GIVEN the FIRMS API is unreachable, rate-limited, or returns an error
- WHEN the system attempts to fetch fire detection data
- THEN the system SHALL fall back to the deterministic mock overlay data, set `status: 'error'`, and display a `NasaFirmsWarning` that live NASA data is unavailable — never a silent success

#### Scenario: FIRMS response contains malformed rows

- GIVEN the FIRMS CSV response includes malformed or partially invalid rows
- WHEN the system parses the response
- THEN the system SHALL skip invalid rows and return the valid remainder without failing the whole request

### Requirement: The system SHALL apply confidence filtering and proximity context to fire detections

The system SHALL classify each detection by FIRMS confidence (`low` / `nominal` / `high` for MODIS; 0–100 mapped to the same bands for VIIRS) and SHALL compute the nearest detection distance to the location of interest.

- Detections below the configured minimum confidence SHALL be excluded when `FIRMS_MIN_CONFIDENCE` is set; default is to show all.
- The nearest-detection context (distance km, bearing, age in hours) is advisory metadata displayed with the wildfires hazard panel and API responses.

#### Scenario: High-confidence detection near the location

- GIVEN a high-confidence detection within the queried bounds
- WHEN the system resolves fire detections for the location
- THEN the system SHALL report the nearest detection's distance and age alongside the overlay data

#### Scenario: Confidence field parses to unknown value

- GIVEN a detection whose confidence value is unrecognized
- WHEN the system classifies it
- THEN the system SHALL treat it as `nominal` rather than dropping it

### Requirement: The system SHALL fetch hazard layers from the NASA DISASTER Hub (ArcGIS REST)

The system SHALL query NASA DISASTER Hosted Data ArcGIS REST endpoints (`https://disasters.nasa.disasterhub.arcgis.com/`, feature-layer queries via the standard `query` endpoint) to retrieve event layers for the region of interest: wildfire perimeters (NIFS/currently hosted incident layers) and flood extents. The system SHALL query with a bounding-box `geometry` + `spatialRel=esriSpatialRelIntersects` filter and handle the layer's `outputSpatialReference` (normalize to WGS84 / EPSG:4326 when required).

#### Scenario: DISASTER Hub returns wildfire perimeter data

- GIVEN the user is viewing a region affected by a recent wildfire event
- WHEN the system queries the DISASTER Hub for wildfire perimeter features
- THEN the system SHALL render the fire perimeter polygons on the map alongside the risk score display

#### Scenario: DISASTER Hub returns no event data for the region

- GIVEN the user is viewing a region with no recorded disaster events
- WHEN the system queries the DISASTER Hub and receives no matching features
- THEN the system SHALL display the map without event overlays and indicate no recent NASA-logged events (empty is success, not an error)

#### Scenario: DISASTER Hub API request fails

- GIVEN the DISASTER Hub is unreachable or returns an error
- WHEN the system attempts to fetch hazard event data
- THEN the system SHALL continue rendering with available data and display a `NasaDisasterWarning` that NASA disaster data is unavailable

### Requirement: NASA overlay data SHALL be provider-adapted, cached, and staleness-tracked

The system SHALL implement FIRMS and DISASTER Hub as provider factories in `src/server/providers/firms.ts` and `src/server/providers/disaster-hub.ts`, accepting an injected `fetcher` for deterministic tests, and resolve them through a `resolveNasaOverlays` layer (`src/server/nasa-overlays.ts`) alongside `hazard-environment.ts`.

- **Cache**: overlay responses SHALL be cached in-process (10 min TTL, bounded entries, matching the weather-cache pattern); cache resets per server instance and is keyed by rounded bounding box + day range.
- **Staleness**: real-time overlays SHALL map observation age to `DataStatus` — FIRMS detections older than 24 h and DISASTER Hub event features older than 30 days are marked `stale`; static/vintage layers are exempt.
- **Mock fallback**: deterministic mock overlays share the fixed synthetic timestamp convention (`mockObservedAt`) so mock data is never reported as fresh.

#### Scenario: Repeated requests within TTL hit the cache

- GIVEN the same bounding box and day range is requested twice within 10 minutes
- WHEN the second request resolves
- THEN the system SHALL serve cached overlay data without an outbound FIRMS/DISASTER Hub call

#### Scenario: Cached entry exceeds staleness threshold

- GIVEN an overlay observation timestamp older than its staleness threshold
- WHEN the system serves the overlay
- THEN the system SHALL report `status: 'stale'` and never present stale data as live

### Requirement: NASA-sourced hazard data SHALL display as toggleable map overlays

The system SHALL integrate NASA FIRMS and DISASTER Hub data into the existing hazard dashboard UI, rendering fire detections and event layers as map overlays alongside the existing deterministic risk scoring, without altering any calculated score. The dashboard SHALL render an interactive Leaflet map (`src/components/FireMap.tsx`) with a cartographic OpenStreetMap raster basemap (client-side tiles, no key, OpenStreetMap attribution required) and FIRMS detections plotted as confidence-coloured markers sourced from `/api/v1/nasa-overlays`; the selected point and search radius are marked. Only live detections are plotted — synthetic mock coordinates are never drawn. The server-side WMS proxy (`/api/v1/nasa-fire-map`) remains available for static-image use.

#### Scenario: NASA data is available and displayed alongside risk score

- GIVEN the user has NASA API data available (FIRMS detections or DISASTER Hub events)
- WHEN the user opens the hazard risk dashboard for a region
- THEN the system SHALL show NASA-sourced map layers as toggleable overlays and keep the deterministic risk score unchanged

#### Scenario: NASA data is unavailable — dashboard degrades gracefully

- GIVEN no NASA API data is available (all providers disabled or failed)
- WHEN the user opens the hazard risk dashboard
- THEN the system SHALL display the dashboard with only deterministic mock data and show a clear indicator that NASA live data is not active

#### Scenario: User toggles NASA map layers on and off

- GIVEN the dashboard is displaying with NASA data overlays
- WHEN the user toggles the "NASA FIRMS" or "NASA DISASTER Hub" layer switch
- THEN the system SHALL show or hide the corresponding map overlay without affecting the risk score or other data

### Requirement: NASA overlay data SHALL be exposed via a server function and API endpoint

The system SHALL expose overlay data consistently:

- A server function (`createServerFn`) in `src/server/nasa-overlays.ts` used by the dashboard route, returning detections, event features, per-provider `DataStatus`, and warnings.
- `GET /api/v1/nasa-overlays?latitude=&longitude=&radiusKm=` — a Rate-limited Nitro handler (60/min per IP, matching `/api/v1/risk`) reusing the same resolution layer; `radiusKm` is 1–100 (default 25 km search radius around the point). Response shape: `{ data: { overlays: { firms: {...} }, warnings: string[], disclaimer } }`. When env providers are unset it returns the deterministic mock payload with the corresponding warnings, never silently pretending to be live.
- `GET /api/v1/nasa-fire-map?latitude=&longitude=&radiusKm=` — a WMS-image proxy (`src/server/nasa-fire-map.ts`, rate-limited 30/min per IP) that fetches the FIRMS `GetMap` PNG (`fires_viirs_24/48/72/7` layers, EPSG:4326, 640×480) server-side and streams it to the `<img>` in the FIRMS panel, so `FIRMS_MAP_KEY` never reaches the client. Day window derives from `FIRMS_DAY_RANGE` (1–2 → 24/48 h, 3–5 → 72 h, 6+ → 7-day). 10-min server cache keyed by rounded center + radius + window + enabled-state; browser `max-age=600`.

#### Scenario: API endpoint queried for a bounded region

- GIVEN a client queries `/api/v1/nasa-overlays` with a valid bounding box
- WHEN the handler resolves overlays
- THEN the system SHALL respond with per-provider status, features, and warnings without exposing any secrets

#### Scenario: Rate limit exceeded

- GIVEN a client exceeds 60 requests per minute
- WHEN the client queries the endpoint again
- THEN the system SHALL answer 429 with the same rate-limit semantics as `/api/v1/risk`

### Requirement: NASA providers SHALL be testable with injected fetchers

Provider factories SHALL accept an injected `fetcher` (the existing convention in `src/server/providers/*.test.ts`) so tests cover: successful CSV/JSON parsing, empty results, HTTP failure fallback, malformed-row skipping, cache behaviour, and staleness classification — with no network access.

#### Scenario: Provider test without network

- GIVEN a provider constructed with a fake fetcher returning fixture data
- WHEN the provider resolves
- THEN the system SHALL return parsed overlay data whose shape matches the server contract, verified under `npm test`

## Non-goals

- No fire-behaviour prediction, spread simulation, or burn-forecasting derived from FIRMS/DISASTER Hub data.
- No evacuation routes or route recommendations from any NASA layer (road data remains display-only).
- No changes to `src/domain/` scorers, weights, or composite logic.
- No client-direct calls to FIRMS or the DISASTER Hub; fetches are server-side only.
