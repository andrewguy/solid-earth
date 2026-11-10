import { geoGraticule10, geoNaturalEarth1, geoPath } from 'd3-geo'

import { type LandTopology, landFeatures } from '@/core/geo/topojson'
import land110m from '@/data/land-110m.topo.json'

const WIDTH = 960
const HEIGHT = 500

// Computed once at module load: static proof-of-pipeline render.
const projection = geoNaturalEarth1().fitExtent(
  [
    [8, 8],
    [WIDTH - 8, HEIGHT - 8],
  ],
  { type: 'Sphere' },
)
const path = geoPath(projection)
const spherePath = path({ type: 'Sphere' }) ?? ''
const graticulePath = path(geoGraticule10()) ?? ''
const landPath = path(landFeatures(land110m as unknown as LandTopology)) ?? ''

export function WorldMap({ className }: { className?: string }) {
  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className={className}
      role="img"
      aria-label="World map (Natural Earth 1:110m land)"
    >
      <path d={spherePath} className="fill-background stroke-border" />
      <path d={graticulePath} className="fill-none stroke-border" strokeWidth={0.5} />
      <path d={landPath} className="fill-muted-foreground/30 stroke-foreground" strokeWidth={0.5} />
    </svg>
  )
}
