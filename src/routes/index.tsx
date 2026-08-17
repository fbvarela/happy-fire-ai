import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'

import { LocationForm } from '../components/LocationForm'
import { ExplanationPanel } from '../components/ExplanationPanel'
import { RiskSummary } from '../components/RiskSummary'
import type { EnvironmentalContext } from '../domain/environment'
import { calculateRisk } from '../domain/risk'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  const [context, setContext] = useState<EnvironmentalContext | null>(null)
  const risk = context ? calculateRisk(context) : null

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Happy Fire home">
          <span className="brand-mark" aria-hidden="true">HF</span>
          <span>Happy Fire</span>
        </a>
        <span className="status-pill">MVP preview</span>
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
        {risk && context ? <RiskSummary result={risk} context={context} /> : (
          <article className="risk-card risk-empty" aria-live="polite">
            <div className="card-heading">
              <span>Current risk</span>
              <span className="muted-label">No location selected</span>
            </div>
            <div className="score-placeholder">--</div>
            <p className="muted-copy">Select a location to calculate a transparent score.</p>
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

      {risk && <ExplanationPanel result={risk} />}

      {context && (
        <article className="info-card road-status-card" aria-labelledby="road-status-title">
          <p className="card-kicker">Official road status</p>
          <h2 id="road-status-title">DGT closure data</h2>
          {!context.roadClosures && !context.roadClosureWarning && (
            <p className="muted-copy">Unavailable until the server-side DGT feed is enabled. No route recommendation is shown.</p>
          )}
          {context.roadClosureWarning && <p className="explanation-error">{context.roadClosureWarning}</p>}
          {context.roadClosures && context.roadClosures.length === 0 && !context.roadClosureWarning && (
            <p className="muted-copy">No nearby active DGT road closures were returned. This is not a route recommendation.</p>
          )}
          {context.roadClosures && context.roadClosures.length > 0 && (
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
