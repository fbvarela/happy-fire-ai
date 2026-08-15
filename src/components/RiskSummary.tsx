import type { EnvironmentalContext } from '../domain/environment'
import type { RiskResult } from '../domain/risk'

type RiskSummaryProps = {
  result: RiskResult
  context: EnvironmentalContext
}

const statusCopy = {
  available: 'Available',
  missing: 'Missing',
  stale: 'Stale',
  error: 'Provider error',
} as const

export function RiskSummary({ result, context }: RiskSummaryProps) {
  const observedAt = new Date(context.observedAt).toLocaleString()
  const hasLimitedData = result.factors.some(({ status }) => status !== 'available')

  return (
    <article className="risk-card risk-summary" aria-labelledby="risk-summary-title">
      <div className="card-heading">
        <span id="risk-summary-title">Current risk</span>
        <span className={`risk-level risk-level-${result.level}`}>{result.level} risk</span>
      </div>
      <div className="score-row">
        <div className="score-value" aria-label={`Risk score ${result.score} out of 100`}>
          {result.score}
        </div>
        <div className="score-meta">
          <strong>{result.confidence}%</strong>
          <span>confidence</span>
        </div>
      </div>
      <p className="safety-note">
        <strong>Informational estimate only.</strong> This product is not an
        official warning, prediction, or evacuation order. During an active
        emergency, follow local emergency services and official fire authorities.
      </p>
      <div
        className="meter"
        role="progressbar"
        aria-label="Risk score"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={result.score}
      >
        <span style={{ width: `${result.score}%` }} />
      </div>
      <dl className="summary-details">
        <div><dt>Model</dt><dd>{result.modelVersion}</dd></div>
        <div><dt>Observed</dt><dd>{observedAt}</dd></div>
        <div><dt>Source</dt><dd>{context.source === 'mock' ? 'Mock data' : 'Open-Meteo'}</dd></div>
      </dl>

      {context.status === 'error' && (
        <p className="data-warning" role="status">
          The weather provider failed, so mock fallback data is shown. Treat this estimate as unavailable until live data is restored.
        </p>
      )}

      <div className="factor-section">
        <div className="card-heading">
          <h2>Risk drivers</h2>
          <span className="muted-label">Weighted contribution</span>
        </div>
        {hasLimitedData && (
          <p className="data-warning" role="status">
            Missing or stale inputs reduce confidence. The affected factors are marked below.
          </p>
        )}
        <ul className="factor-list">
          {result.factors.map((factor) => (
            <li key={factor.id}>
              <div className="factor-name">
                <span>{factor.label}</span>
                {factor.status !== 'available' && (
                  <span className={`factor-status factor-status-${factor.status}`}>
                    {statusCopy[factor.status]}
                  </span>
                )}
              </div>
              <span className="factor-value">+{factor.contribution} pts</span>
            </li>
          ))}
        </ul>
      </div>
    </article>
  )
}
