import 'leaflet/dist/leaflet.css'

import { useEffect, useRef, useState } from 'react'

import type { ConfidenceBand, FireDetection } from '../server/providers/firms'

type FireMapProps = {
  center: { latitude: number; longitude: number }
  detections: FireDetection[]
  radiusKm?: number
}

const confidenceColor: Record<ConfidenceBand, string> = {
  high: '#dc2626',
  nominal: '#f97316',
  low: '#eab308',
}

const escapeHtml = (value: string) => value.replace(/[&<>"]/g, (character) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[character] ?? character
))

export function FireMap({ center, detections, radiusKm = 25 }: FireMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    let cancelled = false
    let map: import('leaflet').Map | null = null

    // Leaflet touches `window`, so it is imported client-side only.
    import('leaflet')
      .then((L) => {
        if (cancelled || !containerRef.current) return
        map = L.map(containerRef.current, { scrollWheelZoom: false, worldCopyJump: true })
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        }).addTo(map)

        L.circle([center.latitude, center.longitude], {
          radius: radiusKm * 1000,
          color: '#2563eb',
          weight: 1,
          fill: false,
        }).addTo(map)
        L.circleMarker([center.latitude, center.longitude], {
          radius: 5,
          color: '#1e3a8a',
          fillColor: '#3b82f6',
          fillOpacity: 1,
          weight: 1,
        }).addTo(map).bindPopup('Selected location')

        for (const detection of detections) {
          L.circleMarker([detection.latitude, detection.longitude], {
            radius: 6,
            color: '#7f1d1d',
            weight: 1,
            fillColor: confidenceColor[detection.confidence],
            fillOpacity: 0.9,
          }).addTo(map).bindPopup(
            `<strong>${escapeHtml(detection.confidence)} confidence</strong><br>` +
            `${Math.round(detection.brightnessK)} K brightness<br>` +
            `${escapeHtml(detection.acquiredAt)}<br>` +
            `${escapeHtml(detection.satellite)} / ${escapeHtml(detection.instrument)} · ${detection.dayNight}`,
          )
        }

        map.fitBounds(L.latLng(center.latitude, center.longitude).toBounds(radiusKm * 2000))
        setLoading(false)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })

    return () => {
      cancelled = true
      if (map) map.remove()
    }
  }, [center.latitude, center.longitude, detections, radiusKm])

  if (failed) {
    return <p className="muted-copy">The interactive map could not be loaded; the detection details above are unaffected.</p>
  }

  return (
    <figure style={{ margin: '0.75rem 0 0' }}>
      {loading && <p className="muted-copy">Loading map…</p>}
      <div
        ref={containerRef}
        role="application"
        aria-label={`Map of active fire detections around ${center.latitude.toFixed(3)}, ${center.longitude.toFixed(3)}`}
        style={{ height: '340px', width: '100%', borderRadius: '0.5rem', border: '1px solid currentColor', position: 'relative', zIndex: 0, isolation: 'isolate' }}
      />
      <figcaption className="data-source-note" style={{ marginTop: '0.4rem' }}>
        Map: OpenStreetMap base map with NASA FIRMS hotspots within {radiusKm} km of the selected point
        (blue marker). Marker colour shows detection confidence (red high, orange nominal, yellow low);
        click a marker for brightness, time and satellite. Display only — the risk score is unaffected.
      </figcaption>
    </figure>
  )
}
