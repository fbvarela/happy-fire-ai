import type { CompositeScore } from '../domain/composite'
import { calculateComposite, hazardGroupLabels, hazardGroups } from '../domain/composite'
import { calculateHazardScores } from '../domain/hazards'
import type { EnvironmentalContext, HazardId } from '../domain/environment'
import type { HazardLevel } from '../domain/hazards/types'

export type HazardTrend = 'up' | 'down' | 'flat'
export type HazardTrends = Partial<Record<HazardId, HazardTrend>>

export const buildComposite = (context: EnvironmentalContext): CompositeScore =>
  calculateComposite(calculateHazardScores(context))

// Trend is computed from the previous fetch for the same location: a rising score is
// worsening (up), a falling score improving (down).
export const computeTrends = (
  previous: CompositeScore | null,
  current: CompositeScore,
): HazardTrends => {
  if (!previous) return {}
  const previousById = new Map(previous.hazards.map(({ id, score }) => [id, score]))
  const trends: HazardTrends = {}
  for (const { id, score } of current.hazards) {
    const previousScore = previousById.get(id)
    if (previousScore === undefined) continue
    if (score > previousScore) trends[id] = 'up'
    else if (score < previousScore) trends[id] = 'down'
    else trends[id] = 'flat'
  }
  return trends
}

const hazardNames: Record<HazardId, string> = {
  wildfire: 'Wildfire',
  radioactivity: 'Radioactivity',
  'water-pollution': 'Water pollution',
  radon: 'Radon',
  flood: 'Flood',
  'air-quality': 'Air quality',
}

const trendGlyph: Record<HazardTrend, string> = { up: '▲', down: '▼', flat: '→' }
const trendLabel: Record<HazardTrend, string> = { up: 'worsening', down: 'improving', flat: 'stable' }

const levelGlyph: Record<HazardLevel, string> = { low: '🟢', medium: '🟡', high: '🔴' }

const freshnessLabel = (observedAt: string | undefined, source: string | undefined) => {
  if (source === 'mock') return 'Synthetic mock data'
  if (!observedAt) return 'Unknown freshness'
  const ageMs = Date.now() - Date.parse(observedAt)
  if (!Number.isFinite(ageMs)) return 'Unknown freshness'
  const minutes = Math.max(0, Math.round(ageMs / 60_000))
  if (minutes < 1) return 'Updated just now'
  if (minutes < 60) return `Updated ${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `Updated ${hours} h ago`
  const days = Math.round(hours / 24)
  if (days < 60) return `Updated ${days} d ago`
  return `Data from ${new Date(observedAt).toLocaleDateString()}`
}

const statusCopy = {
  missing: 'Missing data',
  stale: 'Stale data',
  error: 'Provider error',
} as const

type HazardGridProps = {
  composite: CompositeScore
  context: EnvironmentalContext
  trends?: HazardTrends
}

export function HazardGrid({ composite, context, trends }: HazardGridProps) {
  const overallLevel: HazardLevel = composite.overall <= 33 ? 'low' : composite.overall <= 66 ? 'medium' : 'high'
  const observedByHazard: Record<HazardId, string | undefined> = {
    wildfire: context.observedAt,
    radioactivity: context.radioactivity?.observedAt,
    'water-pollution': context.waterPollution?.observedAt,
    radon: context.radon?.observedAt,
    flood: context.flood?.observedAt,
    'air-quality': context.airQuality?.observedAt,
  }
  const sourceByHazard: Record<HazardId, string | undefined> = {
    wildfire: context.source,
    radioactivity: context.radioactivity?.source,
    'water-pollution': context.waterPollution?.source,
    radon: context.radon?.source,
    flood: context.flood?.source,
    'air-quality': context.airQuality?.source,
  }
  const warningByHazard: Record<HazardId, string | undefined> = {
    wildfire: undefined,
    radioactivity: context.radioactivity?.warning,
    'water-pollution': context.waterPollution?.warning,
    radon: context.radon?.warning,
    flood: context.flood?.warning,
    'air-quality': context.airQuality?.warning,
  }
  const allMock = composite.hazards.every((hazard) => (sourceByHazard[hazard.id] ?? 'mock') === 'mock')

  return (
    <article className="risk-card hazard-grid" aria-labelledby="hazard-grid-title">
      <div className="card-heading">
        <span id="hazard-grid-title">Multi-hazard overview</span>
        <span className={`risk-level risk-level-${overallLevel === 'low' ? 'low' : overallLevel === 'medium' ? 'moderate' : 'high'}`}>
          {overallLevel} risk
        </span>
      </div>
      <div className="score-row">
        <div className="score-value" aria-label={`Overall risk score ${composite.overall} out of 100`}>
          {composite.overall}
        </div>
        <div className="score-meta">
          <strong>/ 100</strong>
          <span>overall risk</span>
        </div>
      </div>
      <div
        className="meter"
        role="progressbar"
        aria-label="Overall risk score"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={composite.overall}
      >
        <span style={{ width: `${composite.overall}%` }} />
      </div>

      {allMock && (
        <p className="data-warning" role="status">
          No live hazard providers are enabled. Every score uses deterministic synthetic
          mock data and is shown for demonstration only.
        </p>
      )}

      {(Object.keys(hazardGroups) as Array<keyof typeof hazardGroups>).map((groupId) => (
        <details key={groupId} className="hazard-group" open={groupId === 'environmental'}>
          <summary>
            <span className="hazard-group-name">{hazardGroupLabels[groupId]}</span>
            <span className="hazard-group-score">{composite.groups[groupId].score}</span>
          </summary>
          <ul className="hazard-list">
            {composite.groups[groupId].hazards.map((hazard) => (
              <li key={hazard.id} className="hazard-row">
                <div className="hazard-name">
                  <span>{hazardNames[hazard.id]}</span>
                  <span className={`hazard-band hazard-band-${hazard.level}`} aria-hidden="true">
                    {levelGlyph[hazard.level]}
                  </span>
                  {trends?.[hazard.id] && (
                    <span
                      className={`hazard-trend hazard-trend-${trends[hazard.id]}`}
                      title={`Trend: ${trendLabel[trends[hazard.id] as HazardTrend]}`}
                    >
                      {trendGlyph[trends[hazard.id] as HazardTrend]}
                    </span>
                  )}
                  {hazard.status !== 'available' && (
                    <span className="hazard-status">{statusCopy[hazard.status]}</span>
                  )}
                  {sourceByHazard[hazard.id] === 'mock' && hazard.status === 'available' && (
                    <span className="hazard-status">Mock data</span>
                  )}
                </div>
                <div className="hazard-value">
                  <span className="hazard-score">{hazard.score}</span>
                  <span className="hazard-freshness">
                    {freshnessLabel(observedByHazard[hazard.id], sourceByHazard[hazard.id])}
                  </span>
                </div>
                {warningByHazard[hazard.id] && (
                  <p className="hazard-warning" role="status">{warningByHazard[hazard.id]}</p>
                )}
              </li>
            ))}
          </ul>
        </details>
      ))}

      <p className="safety-note">
        <strong>Informational estimate only.</strong> Scores are deterministic and
        synthetic mock data is marked. This is not an official warning, prediction,
        or evacuation order.
      </p>
    </article>
  )
}
