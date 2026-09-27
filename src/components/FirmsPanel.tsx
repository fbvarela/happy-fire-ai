import type { FirmsOverlay, NearestFireDetection } from '../server/nasa-overlays'
import { haversineDistanceKm } from '../server/providers/firms'
import { FireMap } from './FireMap'

type FirmsPanelProps = {
  overlay: FirmsOverlay
  location: { latitude: number; longitude: number } | null
}

const bearingLabel = (bearingDeg: number) => {
  const points = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
  return points[Math.round(((bearingDeg % 360) + 360) % 360 / 22.5) % 16]
}

const describeNearest = (nearest: NearestFireDetection) => {
  const direction = bearingLabel(nearest.bearingDeg)
  const age = nearest.ageHours < 48
    ? `${Math.round(nearest.ageHours)} h ago`
    : `${Math.round(nearest.ageHours / 24)} days ago`
  return `${age}, ${nearest.distanceKm} km to the ${direction}`
}

export function FirmsPanel({ overlay, location }: FirmsPanelProps) {
  const { status, source, observedAt, dayRange, detections, nearest, warning } = overlay
  if (location === null) return null
  const counts = {
    high: detections.filter((detection) => detection.confidence === 'high').length,
    nominal: detections.filter((detection) => detection.confidence === 'nominal').length,
    low: detections.filter((detection) => detection.confidence === 'low').length,
  }

  return (
    <article className="info-card road-status-card" aria-labelledby="firms-title">
      <p className="card-kicker">Live satellite data</p>
      <h2 id="firms-title">NASA FIRMS active fire detections</h2>
      {warning && <p className="explanation-error">{warning}</p>}
      {!warning && source === 'mock' && (
        <p className="muted-copy">
          Live NASA FIRMS detections are not active. The map below shows the base map only; no real
          satellite hotspots are plotted.
        </p>
      )}
      {source === 'firms' && (
        <>
          {detections.length === 0 ? (
            <p className="muted-copy">
              No active fire detections were found in the {dayRange === 1 ? 'most recent day' : `last ${dayRange} days`} of satellite passes for this area.
            </p>
          ) : (
            <>
              <p className="muted-copy">
                VIIRS/MODIS satellites detected {detections.length} fire signal{detections.length === 1 ? '' : 's'} in the last{' '}
                {dayRange === 1 ? 'day' : `${dayRange} days`} ({counts.high} high, {counts.nominal} nominal, {counts.low} low confidence):
              </p>
              <ul>
                {detections.slice(0, 5).map((detection, index) => {
                  const distanceKm = Math.round(haversineDistanceKm(location, detection))
                  return (
                    <li key={`${detection.acquiredAt}-${detection.latitude}-${detection.longitude}-${index}`}>
                      {detection.confidence} confidence, {Math.round(detection.brightnessK)} K brightness, {distanceKm} km away
                      {' '}({detection.dayNight}, {detection.satellite})
                    </li>
                  )
                })}
              </ul>
            </>
          )}
          {nearest && (
            <p className="muted-copy">
              Nearest detection: {describeNearest(nearest)} (bearing {nearest.bearingDeg}°, {nearest.confidence} confidence).
            </p>
          )}
          {status === 'stale' && (
            <p className="muted-copy">This FIRMS data is more than 24 hours old and may be out of date.</p>
          )}
        </>
      )}
      {/* Only live detections are plotted; mock coordinates are synthetic and never shown on the map. */}
      <FireMap center={location} detections={source === 'firms' ? detections : []} />
      <p className="data-source-note">
        FIRMS source observed {observedAt}. Detections are informational observations only and do not
        change the calculated risk score; verify with official civil-protection guidance.
      </p>
    </article>
  )
}
