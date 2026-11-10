import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson'
import { feature } from 'topojson-client'
import type { GeometryCollection, Topology } from 'topojson-specification'

/** Shape of world-atlas `land-*.json`. */
export type LandTopology = Topology<{ land: GeometryCollection }>

/** Extract the land polygons from a world-atlas land topology. */
export function landFeatures(topo: LandTopology): FeatureCollection<Polygon | MultiPolygon> {
  return feature(topo, topo.objects.land) as FeatureCollection<Polygon | MultiPolygon>
}
