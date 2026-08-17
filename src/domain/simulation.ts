import type { EnvironmentalContext } from './environment'

export type SimulationCell = 0 | 1 | 2
export type SimulationGrid = SimulationCell[][]

export type SimulationOptions = {
  windDirectionDeg: number
  windKph: number
  slopeDeg: number
  vegetationDryness: number
}

export function describeSimulationScenario(context: EnvironmentalContext): string {
  const wind = context.weather.windKph === null
    ? 'unavailable'
    : `${context.weather.windKph} kph from ${context.weather.windDirectionDeg ?? 'unavailable'}°`
  const slope = context.terrain.slopeDeg === null ? 'unavailable' : `${context.terrain.slopeDeg}°`
  const dryness = context.fuel.vegetationDryness === null
    ? 'unavailable'
    : `${context.fuel.vegetationDryness}%`

  return `Scenario inputs: wind ${wind}, slope ${slope}, vegetation dryness ${dryness}. Data status: ${context.status}. Source observed ${context.observedAt}.`
}

const neighbors = [
  { row: -1, column: 0 },
  { row: 0, column: 1 },
  { row: 1, column: 0 },
  { row: 0, column: -1 },
]

export function stepSimulation(grid: SimulationGrid, options: SimulationOptions): SimulationGrid {
  const next = grid.map((row) => [...row])
  const windRadians = (options.windDirectionDeg * Math.PI) / 180
  const windX = Math.sin(windRadians)
  const windY = -Math.cos(windRadians)
  const baseInfluence = options.vegetationDryness + options.slopeDeg

  grid.forEach((row, rowIndex) => {
    row.forEach((cell, columnIndex) => {
      if (cell !== 1) return
      next[rowIndex][columnIndex] = 2

      neighbors.forEach(({ row: rowOffset, column: columnOffset }) => {
        const targetRow = rowIndex + rowOffset
        const targetColumn = columnIndex + columnOffset
        if (targetRow < 0 || targetRow >= grid.length || targetColumn < 0 || targetColumn >= grid[targetRow].length) {
          return
        }
        if (grid[targetRow][targetColumn] !== 0) return

        const alignment = rowOffset * windY + columnOffset * windX
        const influence = baseInfluence + Math.max(0, alignment) * options.windKph
        if (influence >= 60) next[targetRow][targetColumn] = 1
      })
    })
  })

  return next
}
