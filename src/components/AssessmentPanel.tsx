import type { RiskAssessmentReport } from '../server/assessment'

type AssessmentPanelProps = {
  assessment: RiskAssessmentReport | null
  loading: boolean
}

const qualityCopy: Record<RiskAssessmentReport['dataQuality']['weather']['quality'], string> = {
  complete: 'Complete',
  partial: 'Partial',
  stale: 'Stale',
  fallback: 'Mock fallback',
  unavailable: 'Unavailable',
  error: 'Provider error',
}

const reliabilityCopy: Record<string, string> = {
  'fresh-and-complete': 'Fresh and complete',
  acceptable: 'Acceptable',
  degraded: 'Degraded',
  unusable: 'Unusable',
}

const sufficiencyCopy: Record<number, string> = {
  0: 'Insufficient',
  1: 'Partial',
  2: 'Adequate',
  3: 'Strong',
}

const sufficiencyLabel = (score: number) => sufficiencyCopy[Math.max(0, Math.min(3, Math.round(score)))]

export function AssessmentPanel({ assessment, loading }: AssessmentPanelProps) {
  return (
    <section className="explanation-panel assessment-panel" aria-labelledby="assessment-title" aria-busy={loading}>
      <div className="card-heading">
        <div>
          <p className="card-kicker">Uncertainty and data quality</p>
          <h2 id="assessment-title">Assessment details</h2>
        </div>
        {assessment?.advisory && (
          <span className="muted-label">
            {assessment.advisory.modelVersion ? `AI advisory · ${assessment.advisory.modelVersion}` : 'AI advisory'}
          </span>
        )}
      </div>
      {loading && <p className="explanation-status" role="status" aria-live="polite">Loading assessment...</p>}
      {assessment === null && !loading && (
        <p className="muted-copy">The interval and data-quality report could not be loaded. The displayed estimate remains unchanged.</p>
      )}
      {assessment && (
        <div className="assessment-copy">
          <dl className="summary-details">
            <div><dt>Estimated range</dt><dd>{assessment.interval.low}–{assessment.interval.high}</dd></div>
            <div><dt>Confidence</dt><dd>{assessment.confidenceLevel}</dd></div>
          </dl>
          <p className="muted-copy">
            The range shows where the true conditions could sit given data gaps: uncertainty only widens toward
            caution, never toward calm. It is not a new score.
          </p>

          <div className="card-heading">
            <h2>Data quality</h2>
            <span className="muted-label">Per provider</span>
          </div>
          <ul className="factor-list">
            {Object.entries(assessment.dataQuality).map(([provider, { quality, scoreImpact, note }]) => (
              <li key={provider}>
                <div className="factor-name">
                  <span>{provider}</span>
                  <span className={`factor-status factor-status-${quality === 'complete' ? 'available' : quality}`}>
                    {qualityCopy[quality]}
                  </span>
                </div>
                <span className="factor-value">{scoreImpact ? 'feeds score' : 'display only'}</span>
              </li>
            ))}
          </ul>

          {(assessment.advisoryWarnings.length > 0 || assessment.advisory) && (
            <div className="card-heading">
              <h2>AI advisory</h2>
              <span className="muted-label">Display only</span>
            </div>
          )}
          {assessment.advisoryWarnings.map((warning) => (
            <p key={warning} className="data-warning" role="status">{warning}</p>
          ))}
          {assessment.advisory && (
            <dl className="summary-details">
              <div>
                <dt>Data sufficiency</dt>
                <dd>{sufficiencyLabel(assessment.advisory.dataSufficiency.score)} ({assessment.advisory.dataSufficiency.confidence} conf.)</dd>
              </div>
              {assessment.advisory.anomalies.map((anomaly) => (
                <div key={anomaly.id}>
                  <dt>{anomaly.severity === 'advisory' ? 'Anomaly (advisory)' : 'Anomaly (watch)'}</dt>
                  <dd>{anomaly.description}</dd>
                </div>
              ))}
              {assessment.advisory.reliability.map(({ providerId, level }) => (
                <div key={providerId}>
                  <dt>{providerId} reliability</dt>
                  <dd>{reliabilityCopy[level]}</dd>
                </div>
              ))}
            </dl>
          )}
          <p className="explanation-caveat">
            AI advisory output is explanatory only. It can add caution to the displayed range but never changes the
            score, factors, safety notice, or emergency guidance.
          </p>
        </div>
      )}
    </section>
  )
}
