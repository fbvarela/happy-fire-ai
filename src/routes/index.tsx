import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'

import { AssessmentPanel } from '../components/AssessmentPanel'
import { buildComposite, computeTrends, HazardGrid, type HazardTrends } from '../components/HazardGrid'
import type { CompositeScore } from '../domain/composite'
import { LocationForm } from '../components/LocationForm'
import { ExplanationPanel } from '../components/ExplanationPanel'
import { RiskSummary } from '../components/RiskSummary'
import { ThemeToggle } from '../components/ThemeToggle'
import type { EnvironmentalContext } from '../domain/environment'
import { calculateRisk } from '../domain/risk'
import type { RiskAssessmentReport } from '../server/assessment'
import { getRiskAssessment } from '../server/assessment-service'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  const [context, setContext] = useState<EnvironmentalContext | null>(null)
  const [assessment, setAssessment] = useState<RiskAssessmentReport | null>(null)
  const [assessmentLoading, setAssessmentLoading] = useState(false)
  const risk = context ? calculateRisk(context) : null
  const composite = context ? buildComposite(context) : null
  const contextKey = context
    ? `${context.latitude}:${context.longitude}:${context.localFestivalPressure ?? ''}:${context.roadsideMaintenance ?? ''}:${context.cacheStatus}:${context.source}`
    : ''
  const locationKey = context ? `${context.latitude}:${context.longitude}` : ''
  const [trends, setTrends] = useState<HazardTrends>({})
  const previousCompositeRef = useRef<{ key: string; composite: CompositeScore } | null>(null)

  useEffect(() => {
    if (!composite || !locationKey) {
      setTrends({})
      return
    }
    const previous = previousCompositeRef.current
    if (previous && previous.key === locationKey) {
      setTrends(computeTrends(previous.composite, composite))
    } else {
      setTrends({})
    }
    previousCompositeRef.current = { key: locationKey, composite }
  }, [contextKey])

  useEffect(() => {
    if (!context) {
      setAssessment(null)
      return
    }
    let cancelled = false
    setAssessmentLoading(true)
    getRiskAssessment({
      data: {
        latitude: context.latitude,
        longitude: context.longitude,
        localFestivalPressure: context.localFestivalPressure ?? null,
        roadsideMaintenance: context.roadsideMaintenance ?? null,
      },
    }).then((report) => {
      if (!cancelled) setAssessment(report)
    }).catch(() => {
      if (!cancelled) setAssessment(null)
    }).finally(() => {
      if (!cancelled) setAssessmentLoading(false)
    })
    return () => { cancelled = true }
  }, [contextKey])

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Happy Fire home">
          <span className="brand-mark" aria-hidden="true">HF</span>
          <span>Happy Fire</span>
        </a>
        <div className="topbar-actions">
          <span className="status-pill">MVP preview</span>
          <ThemeToggle />
        </div>
      </header>

      <section className="hero">
        <p className="eyebrow">Forest risk intelligence</p>
        <h1>See the conditions before the fire sees you.</h1>
        <p className="hero-copy">
          Choose a location to compare environmental conditions, understand
          the risk drivers and review local risk conditions.
        </p>
        <LocationForm onContext={setContext} />
      </section>

      <section className="dashboard-grid" aria-label="Risk dashboard">
        {composite && context ? (
          <HazardGrid composite={composite} context={context} trends={trends} />
        ) : (
          <article className="risk-card risk-empty" aria-live="polite">
            <div className="card-heading">
              <span>Overall risk</span>
              <span className="muted-label">No location selected</span>
            </div>
            <div className="score-placeholder">--</div>
            <p className="muted-copy">Select a location to calculate multi-hazard scores.</p>
            <div className="meter" aria-hidden="true"><span /></div>
          </article>
        )}

        <article className="info-card">
          <p className="card-kicker">What we will measure</p>
          <ul>
            <li><span>01</span> Wind and humidity</li>
            <li><span>02</span> Terrain and vegetation</li>
            <li><span>03</span> Seasonal conditions</li>
            <li><span>04</span> Nearby exposure</li>
          </ul>
        </article>
      </section>

      {risk && context && <RiskSummary result={risk} context={context} />}

      {risk && <ExplanationPanel result={risk} assessment={assessment} />}

      {risk && <AssessmentPanel assessment={assessment} loading={assessmentLoading} />}

      {context && (
        <article className="info-card road-status-card" aria-labelledby="road-status-title">
          <p className="card-kicker">Official road status</p>
          <h2 id="road-status-title">DGT closure data</h2>
          {!context.roadClosureSource && !context.roadClosureWarning && (
            <p className="muted-copy">Unavailable until the server-side DGT feed is enabled. No route recommendation is shown.</p>
          )}
          {context.roadClosureWarning && <p className="explanation-error">{context.roadClosureWarning}</p>}
          {context.roadClosureSource && context.roadClosures?.length === 0 && !context.roadClosureWarning && (
            <p className="muted-copy">No nearby active DGT road closures were returned. This is not a route recommendation.</p>
          )}
          {context.roadClosureSource && context.roadClosures && context.roadClosures.length > 0 && (
            <>
              <p className="muted-copy">DGT reports these nearby roads as closed:</p>
              <ul>
                {context.roadClosures.map((closure) => <li key={closure.id}>{closure.roadName} ({closure.status})</li>)}
              </ul>
            </>
          )}
          {context.roadClosureObservedAt && <p className="data-source-note">DGT source observed {context.roadClosureObservedAt}. Verify current road signs and official instructions.</p>}
        </article>
      )}

    </main>
  )
}
