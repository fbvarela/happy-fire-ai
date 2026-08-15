import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
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
          the risk drivers, and explore a hypothetical spread scenario.
        </p>
        <button className="primary-button" type="button">Choose a location</button>
      </section>

      <section className="dashboard-grid" aria-label="Risk dashboard preview">
        <article className="risk-card">
          <div className="card-heading">
            <span>Current risk</span>
            <span className="muted-label">No location selected</span>
          </div>
          <div className="score-placeholder">--</div>
          <p className="muted-copy">Select a location to calculate a transparent score.</p>
          <div className="meter" aria-hidden="true"><span /></div>
        </article>

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

      <footer className="safety-note">
        <strong>Informational estimate only.</strong> This product is not an
        official warning, prediction, or evacuation order.
      </footer>
    </main>
  )
}
