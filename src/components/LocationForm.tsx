import { useState } from 'react'

import type { EnvironmentalContext } from '../domain/environment'
import { getEnvironment } from '../server/environment'

type LocationFormProps = {
  onContext: (context: EnvironmentalContext) => void
}

export function LocationForm({ onContext }: LocationFormProps) {
  const [latitude, setLatitude] = useState('')
  const [longitude, setLongitude] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submitCoordinates = async (nextLatitude: number, nextLongitude: number) => {
    if (!Number.isFinite(nextLatitude) || !Number.isFinite(nextLongitude)) {
      setError('Enter both latitude and longitude.')
      return
    }

    setLoading(true)
    setError(null)

    try {
      onContext(await getEnvironment({ data: { latitude: nextLatitude, longitude: nextLongitude } }))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load this location.')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (loading) return

    void submitCoordinates(Number(latitude), Number(longitude))
  }

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      setError('Browser geolocation is not available.')
      return
    }

    setLoading(true)
    setError(null)
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLatitude(String(coords.latitude))
        setLongitude(String(coords.longitude))
        void submitCoordinates(coords.latitude, coords.longitude)
      },
      () => {
        setLoading(false)
        setError('Unable to access your location. Enter coordinates manually instead.')
      },
    )
  }

  return (
    <form className="location-form" onSubmit={handleSubmit}>
      <div className="location-fields">
        <label>
          Latitude
          <input
            type="number"
            min="-90"
            max="90"
            step="any"
            value={latitude}
            onChange={(event) => setLatitude(event.target.value)}
            required
          />
        </label>
        <label>
          Longitude
          <input
            type="number"
            min="-180"
            max="180"
            step="any"
            value={longitude}
            onChange={(event) => setLongitude(event.target.value)}
            required
          />
        </label>
      </div>
      <div className="location-actions">
        <button className="primary-button" type="submit" disabled={loading}>
          {loading ? 'Loading context...' : 'Analyze location'}
        </button>
        <button className="secondary-button" type="button" onClick={useCurrentLocation} disabled={loading}>
          Use my location
        </button>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
    </form>
  )
}
