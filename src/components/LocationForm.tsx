import { useEffect, useRef, useState } from 'react'

import type { EnvironmentalContext } from '../domain/environment'
import { searchLocationsFn, type LocationSearchResult } from '../server/geocoding'
import { getEnvironment } from '../server/environment'

type LocationFormProps = {
  onContext: (context: EnvironmentalContext) => void
}

const searchDebounceMs = 300
const minQueryLength = 2

export function LocationForm({ onContext }: LocationFormProps) {
  const [latitude, setLatitude] = useState('')
  const [longitude, setLongitude] = useState('')
  const [festivalPressure, setFestivalPressure] = useState('')
  const [roadsideMaintenance, setRoadsideMaintenance] = useState('')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<LocationSearchResult[] | null>(null)
  const [searchNotice, setSearchNotice] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const searchRequestToken = useRef(0)

  const submitCoordinates = async (nextLatitude: number, nextLongitude: number) => {
    if (!Number.isFinite(nextLatitude) || !Number.isFinite(nextLongitude)) {
      setError('Enter both latitude and longitude.')
      return
    }

    setLoading(true)
    setError(null)

    try {
      onContext(await getEnvironment({
        data: {
          latitude: nextLatitude,
          longitude: nextLongitude,
          localFestivalPressure: festivalPressure.trim() === '' ? null : Number(festivalPressure),
          roadsideMaintenance: roadsideMaintenance.trim() === '' ? null : Number(roadsideMaintenance),
        },
      }))
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

  const runSearch = async (value: string) => {
    const token = searchRequestToken.current + 1
    searchRequestToken.current = token

    setSearching(true)
    setError(null)
    setSearchNotice(null)
    setHighlightedIndex(-1)

    try {
      const response = await searchLocationsFn({ data: { query: value } })
      if (searchRequestToken.current !== token) return
      setResults(response.results)
      setSearchNotice(response.warning ?? null)
      if (response.results.length === 0) setError('No matching location was found. Try a different name.')
    } catch (caught) {
      if (searchRequestToken.current !== token) return
      setResults(null)
      setError(caught instanceof Error ? caught.message : 'Unable to search for this location.')
    } finally {
      if (searchRequestToken.current === token) setSearching(false)
    }
  }

  // Predictive search: debounce-triggered while typing; stale responses are dropped by token.
  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < minQueryLength) {
      setResults(null)
      setSearchNotice(null)
      setHighlightedIndex(-1)
      return
    }
    const timer = window.setTimeout(() => void runSearch(trimmed), searchDebounceMs)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  const chooseResult = (result: LocationSearchResult) => {
    setLatitude(String(result.latitude))
    setLongitude(String(result.longitude))
    setResults(null)
    setQuery('')
    setSearchNotice(null)
    void submitCoordinates(result.latitude, result.longitude)
  }

  const handleSearchKeys = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const visible = results ?? []
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlightedIndex(visible.length === 0 ? -1 : (highlightedIndex + 1) % visible.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlightedIndex(visible.length === 0 ? -1 : (highlightedIndex - 1 + visible.length) % visible.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (highlightedIndex >= 0 && visible[highlightedIndex]) {
        chooseResult(visible[highlightedIndex])
      } else if (visible.length === 1) {
        chooseResult(visible[0])
      }
    } else if (event.key === 'Escape') {
      setResults(null)
      setHighlightedIndex(-1)
    }
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
      <div className="location-search">
        <label>
          Search location by name
          <div className="search-field">
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleSearchKeys}
              placeholder="e.g. Valparaíso"
              autoComplete="off"
              role="combobox"
              aria-expanded={results !== null && results.length > 0}
              aria-controls="location-search-results"
              aria-autocomplete="list"
            />
            <button
              className="search-icon-button"
              type="button"
              aria-label={searching ? 'Searching...' : 'Search location'}
              disabled={searching || loading}
            >
              {searching ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="search-spinner">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
              )}
            </button>
          </div>
        </label>
      </div>
      {results && results.length > 0 && (
        <ul className="location-results" id="location-search-results" role="listbox">
          {results.map((result, index) => (
            <li
              key={`${result.latitude},${result.longitude},${index}`}
              role="option"
              aria-selected={index === highlightedIndex}
            >
              <button
                type="button"
                className={index === highlightedIndex ? 'is-highlighted' : undefined}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => chooseResult(result)}
              >
                <span>{result.label}</span>
                <span className="result-coords">
                  {result.latitude.toFixed(4)}, {result.longitude.toFixed(4)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {searchNotice && <p className="data-warning">{searchNotice}</p>}
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
        <label>
          Local festivals/events pressure
          <span className="range-value">{festivalPressure || 'Not set'}</span>
          <input type="range" min="0" max="100" step="1" value={festivalPressure || 0} onChange={(event) => setFestivalPressure(event.target.value)} aria-label="Local festivals and events pressure from 0 to 100" />
        </label>
        <label>
          Roadside ditch maintenance
          <span className="range-value">{roadsideMaintenance || 'Not set'}</span>
          <input type="range" min="0" max="100" step="1" value={roadsideMaintenance || 0} onChange={(event) => setRoadsideMaintenance(event.target.value)} aria-label="Roadside ditch maintenance from 0 to 100" />
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
      <p className="muted-copy">These two values are manual estimates for now. Higher festival pressure raises risk; higher ditch maintenance lowers it.</p>
    </form>
  )
}
