import { createServerFn } from '@tanstack/react-start'

import type { EnvironmentalContext } from '../domain/environment'

type Coordinates = {
  latitude: number
  longitude: number
}

const observedAt = '2026-01-01T00:00:00.000Z'

const validateCoordinates = (coordinates: Coordinates) => {
  if (
    !Number.isFinite(coordinates.latitude) ||
    coordinates.latitude < -90 ||
    coordinates.latitude > 90 ||
    !Number.isFinite(coordinates.longitude) ||
    coordinates.longitude < -180 ||
    coordinates.longitude > 180
  ) {
    throw new Error('Enter a latitude between -90 and 90 and a longitude between -180 and 180.')
  }

  return coordinates
}

export const getEnvironment = createServerFn({ method: 'GET' })
  .validator(validateCoordinates)
  .handler(({ data }): EnvironmentalContext => {
    const latitude = data.latitude
    const longitude = data.longitude
    const latitudeSignal = Math.abs(latitude) % 1
    const longitudeSignal = Math.abs(longitude) % 1

    return {
      latitude,
      longitude,
      observedAt,
      status: 'available',
      weather: {
        temperatureC: 18 + Math.round(latitudeSignal * 12),
        humidity: 35 + Math.round(longitudeSignal * 40),
        precipitationMm24h: Math.round((1 + latitudeSignal * 8) * 10) / 10,
        windKph: 8 + Math.round(longitudeSignal * 18),
        windDirectionDeg: Math.round((longitude + 180) % 360),
      },
      terrain: {
        slopeDeg: Math.round((latitudeSignal * 25 + longitudeSignal * 10) * 10) / 10,
        elevationM: 120 + Math.round((latitudeSignal + longitudeSignal) * 900),
      },
      fuel: {
        vegetationDryness: Math.round((35 + latitudeSignal * 55) * 10) / 10,
      },
      exposure: {
        nearbyPeople: 400 + Math.round(longitudeSignal * 4000),
      },
      seasonWeatherProxy: Math.round((40 + longitudeSignal * 45) * 10) / 10,
    }
  })
