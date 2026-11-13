# Solid Earth

Turn a world map into laser-cut panels that assemble into a polyhedral globe.

Pick a solid (icosahedron, truncated icosahedron "soccer ball", cube, … or your own convex
shape), spin the globe underneath it, and export **one SVG per face** at real size in
millimetres, with separate LightBurn layers for cutting, engraving and scoring.

Each face uses a gnomonic projection from the centre of the solid, which maps great circles to
straight lines. Coastlines, borders and the graticule therefore continue exactly across every
edge when the panels are assembled.

**For makers:** see the [maker guide](docs/MAKING.md) for choosing a shape and size, LightBurn
settings, kerf, and assembly.

## Features (Release 1)

- **Shapes:** the 5 Platonic, 13 Archimedean and 13 Catalan solids (Catalan solids have every
  panel identical), plus import of any convex polyhedron from **OBJ** or **JSON** (triangulated
  meshes are merged back into flat faces).
- **Map layers:** coastlines, country borders, rivers, lakes, land and ocean fills, graticule.
  Each layer has its own on/off switch, mode (fill, shore line or both) and LightBurn colour.
- **Data:** Natural Earth at 1:110m and 1:50m, bundled with the app.
- **Star chart:** switch the subject to the night sky for a celestial globe: stars sized by
  brightness (dots or rings), constellation lines, the Milky Way, the ecliptic and equator, and an
  RA/Dec grid, as a traditional globe or as seen from Earth. Bright stars can be cut right through
  the panels so a light inside projects the sky onto the walls.
- **3D preview:** drag to rotate the globe under the solid; panels are textured with exactly what
  gets exported.
- **Laser-ready SVGs:** true mm scale, north-up panels, Inkscape layers, exact LightBurn palette
  colours, optional kerf compensation on the cut path only.
- **Square-cut butt joints:** panel edges are inset for your material thickness so neighbouring
  panels meet at their inner corners; the panel info lists dihedral angles, insets and the width
  of the outer V-groove.
- **Finger joints (optional):** interlocking fingers on every edge, sized for your material and
  the angle at each joint, with adjustable finger width and clearance and a choice of fingers
  that fill the joint (sand flush) or sit flush.
- **Sanded bevel joints (optional):** panels are cut a small sanding allowance oversize, with the
  true edge engraved as a sanding guide. Sand each edge to the bevel angle shown until the front
  reaches the guide, and the outer faces meet with no groove.
- **Sheet nesting:** lay all panels out on sheets of any size (presets for common stock and
  laser beds), with a gap and margin measured on the real cut path and a rotation choice that can
  keep plywood grain consistent. A genetic optimiser minimises the sheet count and keeps the
  offcut in one strip.
- **Export:** per-face SVG, per-sheet SVG, or a ZIP of all faces, sheets and `project.json`.
- **Projects:** autosaved in the browser; open/save project files.

Everything runs in the browser. There is no server and nothing is uploaded.

### Default LightBurn layers

| Output                                       | LightBurn layer | Colour    |
| -------------------------------------------- | --------------- | --------- |
| Cut (panel outline)                          | 02              | `#FF0000` |
| Engraved lines (coastlines, borders, rivers) | 00              | `#000000` |
| Engraved fills (land, lakes, ocean)          | 01              | `#0000FF` |
| Score (graticule)                            | 03              | `#00E000` |
| Sanding guide (bevel joints only)            | 04              | `#D0D000` |
| Star holes (night sky, cut)                  | 05              | `#FF8000` |
| Stars (night sky)                            | 06              | `#00E0E0` |

All colours can be changed per layer from LightBurn's palette. The optional sheet outline uses
LightBurn's T1 tool layer (`#F36926`), which is never cut; see the maker guide before turning it
on.

## Development

Requires Node 26 (`nvm use` picks it up from `.nvmrc`).

```sh
npm install
npm run dev          # Vite dev server
npm test             # Vitest (FC_NUM_RUNS=5000 npm test for thorough property runs)
npm run typecheck    # tsc -b
npm run lint         # ESLint
npm run build        # typecheck + production build
npm run build:data   # regenerate map data (see below)
```

### Deployment

`.github/workflows/ci.yml` runs typecheck, lint, format check, tests and build on every push and
pull request, and deploys `dist/` to GitHub Pages from `main` when they all pass. Production
builds use the base path `/solid-earth/`; set `BASE_PATH` (e.g. `BASE_PATH=/ npm run build`) for
a custom domain or another host.

### Project layout

```
src/core/     pure TypeScript geometry pipeline (no DOM; runs in the worker; fully tested)
  polyhedron/   presets, OBJ/JSON import, preprocessing and validation
  geo/          TopoJSON extraction, seams, densifying, lon/lat ↔ vectors, rotation
  clip/         clipping on the sphere (polylines, polygons) and culling
  project/      gnomonic projection, north-up orientation
  planar/       Clipper2 wrapper: unions, differences, kerf offset, rounding
  export/       SVG (faces and sheets), ZIP, project files
  nest/         sheet nesting: convex parts, no-fit polygons, placement, genetic optimiser
  pipeline.ts   rotate → clip → project → per-face artwork
  panel-shape.ts  panel cut outlines without map data (for nesting)
src/worker/   the projection pipeline and the nester behind web workers, data loading
src/ui/       React app: zustand store, react-three-fiber preview, panels
scripts/      build-data.ts
tests/        Vitest unit tests and fast-check property tests
```

`plan.md` holds the full design: algorithm, decisions and acceptance criteria.

## Map data

`src/data/` is generated by `scripts/build-data.ts` and committed:

- `countries-*.topo.json`, `land-*.topo.json`: copied from the pinned
  [world-atlas](https://github.com/topojson/world-atlas) npm package.
- `lakes-*.topo.json`, `rivers-*.topo.json`: Natural Earth GeoJSON at a pinned tag, downloaded
  (cached in `.cache/`), ring winding normalised to the d3 convention, and converted to TopoJSON.

- `sky.json`: stars to magnitude 6, constellation lines and the outermost Milky Way outline from
  the pinned [d3-celestial](https://github.com/ofrohn/d3-celestial) npm package, packed compactly.

`npm run build:data -- --skip-natural-earth` rebuilds only the world-atlas and sky files (no
network).

Borders follow Natural Earth's default point of view; disputed areas are shown as Natural Earth
draws them.

## Licences

- Code: MIT (see [LICENSE](LICENSE)).
- Map data: [Natural Earth](https://www.naturalearthdata.com/), public domain; packaged by
  world-atlas (ISC).
- Sky data: [d3-celestial](https://github.com/ofrohn/d3-celestial) (BSD-3-Clause); stars from
  XHIP (Anderson & Francis 2012), constellation lines after the IAU, Milky Way outline from Jose
  R. Vieira's Milky Way Outline Catalog.
- Libraries: d3 and topojson (ISC), three.js (MIT), Clipper2 TypeScript port (Boost Software
  License 1.0), and others listed in `package.json`.
