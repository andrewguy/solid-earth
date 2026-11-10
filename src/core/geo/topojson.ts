import { geoGraticule } from 'd3-geo'
import type { FeatureCollection, MultiPolygon, Polygon, Position } from 'geojson'
import { feature, mesh } from 'topojson-client'
import type { GeometryCollection, Topology } from 'topojson-specification'

/** Shape of world-atlas `land-*.json`. */
export type LandTopology = Topology<{ land: GeometryCollection }>
/** Shape of world-atlas `countries-*.json`. */
export type CountriesTopology = Topology<{
  countries: GeometryCollection
  land: GeometryCollection
}>
/** Natural Earth lakes, as built by scripts/build-data.ts. */
export type LakesTopology = Topology<{ lakes: GeometryCollection }>
/** Natural Earth rivers and lake centrelines, as built by scripts/build-data.ts. */
export type RiversTopology = Topology<{ rivers: GeometryCollection }>

/** Extract the land polygons from a world-atlas land topology. */
export function landFeatures(topo: LandTopology): FeatureCollection<Polygon | MultiPolygon> {
  return feature(topo, topo.objects.land) as FeatureCollection<Polygon | MultiPolygon>
}

/**
 * Coastlines as shared arcs (plan §4.2): the mesh of the land layer, so each stretch of coast
 * appears once. May still contain antimeridian/pole seams; run through `prepareLines`.
 */
export function coastlineLines(topo: LandTopology): Position[][] {
  return mesh(topo, topo.objects.land).coordinates
}

/** Internal country borders: arcs shared by two different countries. */
export function borderLines(topo: CountriesTopology): Position[][] {
  return mesh(topo, topo.objects.countries, (a, b) => a !== b).coordinates
}

/** Lake shorelines as shared arcs. */
export function lakeShoreLines(topo: LakesTopology): Position[][] {
  return mesh(topo, topo.objects.lakes).coordinates
}

/** River centrelines as shared arcs. */
export function riverLines(topo: RiversTopology): Position[][] {
  return mesh(topo, topo.objects.rivers).coordinates
}

/** Polygons (each: exterior ring then holes) of a polygon collection. */
export function polygonsOf(fc: FeatureCollection): Position[][][] {
  return fc.features.flatMap((f) => {
    const g = f.geometry
    if (g?.type === 'Polygon') return [g.coordinates]
    if (g?.type === 'MultiPolygon') return g.coordinates
    return []
  })
}

export const landPolygons = (topo: LandTopology) => polygonsOf(landFeatures(topo))

export const lakePolygons = (topo: LakesTopology) =>
  polygonsOf(feature(topo, topo.objects.lakes) as FeatureCollection)

/** Graticule lines every `stepDeg` degrees (plan §6.2), meridians stopping just short of the poles. */
export function graticuleLines(stepDeg: number): Position[][] {
  return geoGraticule()
    .stepMajor([stepDeg, stepDeg])
    .stepMinor([stepDeg, stepDeg])
    .lines()
    .map((l) => l.coordinates)
}
