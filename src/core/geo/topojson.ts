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
