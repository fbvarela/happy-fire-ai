import { describe, expect, it } from 'vitest'

import { createDgtRoadClosureProvider, parseDgtRoadClosures } from './evacuation'

const feed = (publicationTime: string, type = 'roadClosed') => `<?xml version="1.0"?>
<d2:payload xmlns:sit="http://levelC/schema/3/situation" xmlns:com="http://levelC/schema/3/common" xmlns:loc="http://levelC/schema/3/locationReferencing">
  <com:publicationTime>${publicationTime}</com:publicationTime>
  <sit:situation id="situation-1">
    <sit:situationRecord id="record-1">
      <sit:validity><com:validityStatus>active</com:validityStatus><com:validityTimeSpecification><com:overallStartTime>2026-08-17T09:00:00Z</com:overallStartTime></com:validityTimeSpecification></sit:validity>
      <sit:locationReference><loc:supplementaryPositionalDescription><loc:roadInformation><loc:roadName>A-23</loc:roadName></loc:roadInformation></loc:supplementaryPositionalDescription><loc:tpegLinearLocation><loc:from><loc:pointCoordinates><loc:latitude>40.0001</loc:latitude><loc:longitude>-3.0001</loc:longitude></loc:pointCoordinates></loc:from></loc:tpegLinearLocation></sit:locationReference>
      <sit:roadOrCarriagewayOrLaneManagementType>${type}</sit:roadOrCarriagewayOrLaneManagementType>
    </sit:situationRecord>
  </sit:situation>
</d2:payload>`

describe('DGT road closure parser', () => {
  it('returns active nearby closures with source metadata', () => {
    expect(parseDgtRoadClosures(feed('2026-08-17T09:17:34Z'), 40, -3, Date.parse('2026-08-17T09:18:00Z'))).toEqual({
      sourceTimestamp: '2026-08-17T09:17:34.000Z',
      closures: [{
        id: 'record-1',
        roadName: 'A-23',
        status: 'closed',
        latitude: 40.0001,
        longitude: -3.0001,
        validFrom: '2026-08-17T09:00:00.000Z',
      }],
    })
  })

  it('rejects stale, malformed, and non-closure records', () => {
    expect(() => parseDgtRoadClosures(feed('2026-08-17T08:00:00Z'), 40, -3, Date.parse('2026-08-17T09:00:00Z'))).toThrow('stale')
    expect(() => parseDgtRoadClosures('<payload />', 40, -3)).toThrow('publication time')
    expect(parseDgtRoadClosures(feed('2026-08-17T09:17:34Z', 'lanesDeviated'), 40, -3, Date.parse('2026-08-17T09:18:00Z')).closures).toEqual([])
  })

  it('fetches and labels the official DGT source', async () => {
    const provider = createDgtRoadClosureProvider(async (input) => {
      expect(input.toString()).toContain('nap.dgt.es/datex2/v3/dgt/SituationPublication')
      return new Response(feed(new Date().toISOString()))
    })

    await expect(provider.getNearbyClosures(40, -3)).resolves.toMatchObject({ source: 'dgt' })
  })
})
