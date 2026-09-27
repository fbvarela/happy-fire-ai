import { describe, expect, it } from 'vitest'

import {
  clampDayRange,
  classifyConfidence,
  createFirmsProvider,
  haversineDistanceKm,
  initialBearingDeg,
  parseFirmsCsv,
  resolveFirmsSource,
  type FirmsBoundingBox,
} from './firms'

const bounds: FirmsBoundingBox = { west: -0.3, south: 39.4, east: 0.3, north: 40.0 }

const csvResponse = (payload: string, status = 200) => new Response(payload, { status })

const viirsCsv = `latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight
39.750,0.150,342.1,0.48,0.42,2026-09-27,530,Suomi-NPP,VIIRS,86,2.0,301.2,8.4,D
39.500,0.010,356.0,0.50,0.44,2026-09-27,1147,Suomi-NPP,VIIRS,low,2.0,302.0,12.1,N`

const modisCsv = `latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight
39.620,0.050,318.2,1.0,1.0,2026-09-26,1200,Terra,MODIS,h,6.0,304.0,4.9,N`

describe('FIRMS provider', () => {
  it('parses VIIRS rows with acquisition time, day/night and confidence', async () => {
    const provider = createFirmsProvider({ mapKey: 'key' }, async () => csvResponse(viirsCsv))
    const result = await provider.getFireDetections(bounds)
    expect(result.detections).toHaveLength(2)
    expect(result.detections[0]).toMatchObject({
      latitude: 39.5,
      longitude: 0.01,
      acquiredAt: '2026-09-27T11:47:00Z',
      confidence: 'low',
      dayNight: 'night',
    })
    expect(result.detections[1]).toMatchObject({
      latitude: 39.75,
      longitude: 0.15,
      brightnessK: 342.1,
      scan: 0.48,
      track: 0.42,
      acquiredAt: '2026-09-27T05:30:00Z',
      satellite: 'Suomi-NPP',
      instrument: 'VIIRS',
      confidence: 'high',
      dayNight: 'day',
      frp: 8.4,
    })
    expect(result.observedAt).toBe('2026-09-27T11:47:00Z')
  })

  it('sorts detections newest-first and classifies MODIS letter confidence', async () => {
    const payload = `${modisCsv}\n${viirsCsv}`
    const provider = createFirmsProvider({ mapKey: 'key' }, async () => csvResponse(payload))
    const result = await provider.getFireDetections(bounds)
    expect(result.detections.map((detection) => detection.acquiredAt)).toEqual([
      '2026-09-27T11:47:00Z',
      '2026-09-27T05:30:00Z',
      '2026-09-26T12:00:00Z',
    ])
    expect(result.detections[2].confidence).toBe('high')
  })

  it('maps numeric confidence to low/nominal/high bands', () => {
    expect(classifyConfidence('96')).toBe('high')
    expect(classifyConfidence('50')).toBe('nominal')
    expect(classifyConfidence('10')).toBe('low')
    expect(classifyConfidence('')).toBe('nominal')
    expect(classifyConfidence('unexpected')).toBe('nominal')
  })

  it('skips malformed rows without failing the request', async () => {
    const payload = `latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight
38.750,0.150,342.1,0.48,0.42,2026-09-27,530,Suomi-NPP,VIIRS,86,2.0,301.2,8.4,D
bad,row
39.700,0.200,abc,x,x,not-a-date,nonsense,Suomi-NPP,VIIRS,86,x,x,x,D
39.650,0.250,340.0,0.5,0.4,2026-09-27,1030,Suomi-NPP,VIIRS,70,2.0,300.0,6.0,D`
    const provider = createFirmsProvider({ mapKey: 'key' }, async () => csvResponse(payload))
    const result = await provider.getFireDetections(bounds)
    expect(result.detections).toHaveLength(1)
    expect(result.detections[0].latitude).toBe(39.65)
  })

  it('keeps detections with negative longitudes', () => {
    // Portugal-style row: latitude first, negative longitude (west of the prime meridian).
    const parsed = parseFirmsCsv(
      `latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight
38.350,-6.000,300.55,0.52,0.67,2026-09-26,900,N,VIIRS,n,2.0NRT,292.51,1.25,N`,
      { west: -6.1, south: 38.3, east: -5.9, north: 38.4 },
    )
    expect(parsed.detections).toHaveLength(1)
    expect(parsed.detections[0].latitude).toBe(38.35)
    expect(parsed.detections[0].longitude).toBe(-6.0)
  })

  it('treats an empty detection list as success', async () => {
    const payload = 'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight\n'
    const provider = createFirmsProvider({ mapKey: 'key' }, async () => csvResponse(payload))
    const result = await provider.getFireDetections(bounds)
    expect(result.detections).toEqual([])
    expect(result.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('falls back to an error for HTTP failures and unparsable bodies', async () => {
    const failing = createFirmsProvider({ mapKey: 'key' }, async () => csvResponse('missing', 500))
    await expect(failing.getFireDetections(bounds)).rejects.toThrow('FIRMS request failed (500)')

    const garbage = createFirmsProvider({ mapKey: 'key' }, async () => csvResponse('not,a,header\n1,2'))
    await expect(garbage.getFireDetections(bounds)).rejects.toThrow('Invalid FIRMS response')
  })

  it('builds the documented area URL and clamps the day range', async () => {
    let requestedUrl = ''
    const provider = createFirmsProvider({ mapKey: 'secret-key' }, async (input) => {
      requestedUrl = input.toString()
      return csvResponse(modisCsv)
    })
    await provider.getFireDetections(bounds, 99)
    const url = new URL(requestedUrl)
    expect(url.origin + url.pathname).toBe('https://firms.modaps.eosdis.nasa.gov/api/area/csv/secret-key/VIIRS_SNPP_NRT/-0.300000,39.400000,0.300000,40.000000/5')
  })

  it('applies the minimum-confidence filter when configured', async () => {
    const payload = `${modisCsv}\n${viirsCsv}`
    const provider = createFirmsProvider({ mapKey: 'key', minConfidence: 'nominal' }, async () => csvResponse(payload))
    const result = await provider.getFireDetections(bounds)
    expect(result.detections.every((detection) => detection.confidence !== 'low')).toBe(true)
  })

  it('computes distance and bearing between points', () => {
    const from = { latitude: 39.5, longitude: 0.0 }
    const east = { latitude: 39.5, longitude: 0.1 }
    const north = { latitude: 39.6, longitude: 0.0 }
    expect(haversineDistanceKm(from, east)).toBeGreaterThan(7)
    expect(haversineDistanceKm(from, east)).toBeLessThan(10)
    expect(haversineDistanceKm(from, north)).toBeGreaterThan(10)
    expect(haversineDistanceKm(from, north)).toBeLessThan(12.5)
    expect(Math.round(initialBearingDeg(from, east))).toBe(90)
    expect(Math.round(initialBearingDeg(from, north))).toBe(0)
  })

  it('clamps the day range into the supported FIRMS window', () => {
    expect(clampDayRange(undefined)).toBe(2)
    expect(clampDayRange(0)).toBe(1)
    expect(clampDayRange(5)).toBe(5)
    expect(clampDayRange(99)).toBe(5)
  })

  it('falls back to the default source for unknown FIRMS source ids', () => {
    expect(resolveFirmsSource('VIIRS_SNPP_NOAA20_375m_NRT')).toBe('VIIRS_SNPP_NRT')
    expect(resolveFirmsSource('MODIS_SP')).toBe('MODIS_SP')
    expect(resolveFirmsSource(undefined)).toBe('VIIRS_SNPP_NRT')
  })
})
