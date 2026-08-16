import { useEffect, useRef, useState } from 'react'

import type { EnvironmentalContext } from '../domain/environment'
import {
  type SimulationGrid,
  type SimulationOptions,
  stepSimulation,
} from '../domain/simulation'

type FireSimulationProps = {
  context: EnvironmentalContext | null
}

const initialGrid: SimulationGrid = Array.from({ length: 10 }, (_, row) =>
  Array.from({ length: 16 }, (_, column) => (row === 5 && column === 7 ? 1 : 0)),
)

const getOptions = (context: EnvironmentalContext | null): SimulationOptions => ({
  windDirectionDeg: context?.weather.windDirectionDeg ?? 0,
  windKph: context?.weather.windKph ?? 15,
  slopeDeg: context?.terrain.slopeDeg ?? 10,
  vegetationDryness: context?.fuel.vegetationDryness ?? 60,
})

export const describeSimulationAssumptions = (context: EnvironmentalContext | null) => {
  if (!context) return 'Fallback assumptions: wind direction north, wind speed 15 kph, slope 10°, vegetation dryness 60.'

  if (context.status === 'error') {
    return `Mock fallback assumptions are being used: wind ${context.weather.windKph ?? 15} kph, direction ${context.weather.windDirectionDeg ?? 0}°, slope ${context.terrain.slopeDeg ?? 10}°, dryness ${context.fuel.vegetationDryness ?? 60}.`
  }

  const missing = [
    context.weather.windDirectionDeg === null ? 'wind direction north' : null,
    context.weather.windKph === null ? 'wind speed 15 kph' : null,
    context.terrain.slopeDeg === null ? 'slope 10°' : null,
    context.fuel.vegetationDryness === null ? 'vegetation dryness 60' : null,
  ].filter((value): value is string => value !== null)

  return missing.length > 0
    ? `Fallback assumptions: ${missing.join(', ')}.`
    : `Using selected context: wind ${context.weather.windKph} kph, direction ${context.weather.windDirectionDeg}°, slope ${context.terrain.slopeDeg}°, dryness ${context.fuel.vegetationDryness}.`
}

export function FireSimulation({ context }: FireSimulationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [grid, setGrid] = useState<SimulationGrid>(initialGrid)
  const [stepCount, setStepCount] = useState(0)
  const [running, setRunning] = useState(false)
  const options = getOptions(context)

  const advance = () => {
    setGrid((current) => stepSimulation(current, options))
    setStepCount((current) => current + 1)
  }

  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(advance, 700)
    return () => window.clearInterval(timer)
  }, [running, options.windDirectionDeg, options.windKph, options.slopeDeg, options.vegetationDryness])

  useEffect(() => {
    setGrid(initialGrid)
    setStepCount(0)
    setRunning(false)
  }, [context])

  useEffect(() => {
    const canvas = canvasRef.current
    const drawingContext = canvas?.getContext('2d')
    if (!canvas || !drawingContext) return

    const cellWidth = canvas.width / grid[0].length
    const cellHeight = canvas.height / grid.length
    drawingContext.fillStyle = '#101714'
    drawingContext.fillRect(0, 0, canvas.width, canvas.height)
    grid.forEach((row, rowIndex) => row.forEach((cell, columnIndex) => {
      drawingContext.fillStyle = cell === 1 ? '#ffad91' : cell === 2 ? '#76564b' : '#294238'
      drawingContext.fillRect(columnIndex * cellWidth + 1, rowIndex * cellHeight + 1, cellWidth - 2, cellHeight - 2)
    }))
  }, [grid])

  const reset = () => {
    setRunning(false)
    setGrid(initialGrid)
    setStepCount(0)
  }

  return (
    <section className="simulation-card" aria-labelledby="simulation-title">
      <div className="card-heading">
        <div>
          <p className="card-kicker">Bounded model</p>
          <h2 id="simulation-title">Hypothetical scenario</h2>
        </div>
        <span className="simulation-step">Step {stepCount}</span>
      </div>
      <p className="muted-copy">
        A deterministic illustration of adjacent spread, not a forecast or evacuation route.
      </p>
      <canvas ref={canvasRef} className="simulation-canvas" width="640" height="400" aria-label="Hypothetical fire spread grid" />
      <div className="simulation-controls" aria-label="Simulation controls">
        <button className="primary-button" type="button" onClick={() => setRunning(true)} disabled={running}>Start</button>
        <button className="secondary-button" type="button" onClick={() => setRunning(false)} disabled={!running}>Pause</button>
        <button className="secondary-button" type="button" onClick={advance} disabled={running}>Step</button>
        <button className="secondary-button" type="button" onClick={reset}>Reset</button>
      </div>
      <p className="simulation-assumptions">
        {describeSimulationAssumptions(context)}
      </p>
    </section>
  )
}
