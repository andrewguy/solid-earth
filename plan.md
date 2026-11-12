# Solid Earth (polyhedral map projector): Project Plan

> Status: **Release 1 functionally complete (2026-11-10)**. Milestone 9 (deployment) is prepared:
> the CI/Pages workflow and base path are in place, pending creation of the `solid-earth` repo and
> the first push. Milestones 1–8 and 10 are implemented and tested; see §11 for progress, changes from
> this plan, and the manual checks still outstanding. Post-R1: sheet nesting (§13) is complete
> (2026-11-13).

---

## 1. Overview

A client-side web app that takes vector world-map data (countries, coastlines, rivers, lakes, graticule) and projects it onto the faces of a chosen polyhedron (icosahedron, cube, truncated icosahedron/soccer ball, or a custom convex solid). It exports **one SVG per face** in real-world millimetres, with separate laser layers for cutting and engraving. The cut panels assemble into a physical 3D globe.

**Audience:** the author, plus other makers it is shared with. It is a hosted static site with decent UX and maker-facing docs. It is not a polished commercial product.

**Approach in one line:** the sphere is projected radially from the solid's centre onto each face plane (gnomonic projection per face). This maps great circles to straight lines, so features continue exactly across shared edges.

---

## 2. Requirements

### 2.1 Release 1 (panel mode)
- Load Natural Earth vector data. 110m and 50m are bundled. (10m was dropped; see §11.)
- Polyhedron presets: the 5 Platonic, 13 Archimedean and 13 Catalan solids (the original list was tetrahedron, cube, octahedron, dodecahedron, icosahedron, truncated icosahedron; the rest were added after R1, see §11). The icosahedron is the primary dev/test target.
- **Custom polyhedra, early:** import from OBJ and from JSON `{vertices, faces}`. Convex only.
- Project the map onto each face, clipped to the face polygon, with exact edge continuity across neighbouring faces.
- 2D preview of each face, and a 3D preview of the assembled solid with the map applied.
- Rotate the globe under the polyhedron by dragging in the 3D preview.
- Layers with per-layer toggles and stroke/fill settings: coastlines, country borders, rivers, lakes, land fill, ocean fill, graticule.
- Laser output separated by operation, with LightBurn colour conventions (configurable): **cut** (face outline), **engrave** (lines and fills), **score** (graticule by default).
- Panel mode: material thickness setting, square-cut butt joints (edges inset so inner corners meet), optional kerf compensation, dihedral, inset and V-groove info.
- Export an SVG per face, and a ZIP of all faces plus the project file.
- Save the project in the browser automatically, and import/export a project JSON file.

### 2.2 Later releases (backlog, rough priority order)
1. Paper/card mode: unfolded net export on a single sheet with fold/score lines and glue tabs.
2. Assembly aids: edge/face ID labels, assembly guide sheet.
3. Bevel joints.
4. Nested sheet export for a given laser bed size. **Done 2026-11-13; see §13.**
5. Internal frame/connector generation.
6. Finger joints. **Scoped 2026-11-11; see §12.**
7. DXF export.
8. Custom GeoJSON layers (e.g. travel routes).
9. Rotation presets and optimiser (e.g. vertex at north pole, minimise land cut by edges).
10. Text labels (needs font-to-path conversion).
11. Optional alternative per-face projection (e.g. azimuthal equidistant), with a warning that edge continuity breaks.

---

## 3. Decisions

| Topic | Decision |
|---|---|
| UI framework | React + TypeScript (strict). react-three-fiber for 3D. |
| Platforms | Desktop evergreen browsers (Chrome, Firefox, Safari, Edge), mouse and keyboard. |
| Local-first | Development runs locally (`npm run dev`, `npm test`) until R1 is functionally complete. Hosting and CI come in milestone 9. |
| Hosting | GitHub Pages, deployed via GitHub Actions (milestone 9). |
| CI/CD | One workflow: typecheck, lint, test, build, then deploy on `main`. Deploy only runs if tests pass (milestone 9). |
| UI components | **Tailwind CSS + shadcn/ui** for all standard controls: buttons, inputs, selects, sliders, switches, tabs, dialogs, popovers, tooltips, tables, toasts. No hand-rolled versions of these. Custom components only where shadcn has nothing suitable (3D canvas, face preview, LightBurn palette swatches built from shadcn Popover), styled with Tailwind. |
| License / repo | MIT, public GitHub repo. Natural Earth is public domain, d3 is ISC, three.js is MIT; all compatible. |
| Backend | None. Fully client-side. Exports are Blob downloads; JSZip builds the bundle. |
| Custom polyhedron input | OBJ file and JSON `{vertices, faces}`. Both go through the same preprocessing (weld, merge coplanar, orient, validate). |
| Custom polyhedron constraints | **Convex only.** Non-convex or non-manifold input is rejected with a clear message. |
| Laser software | LightBurn. Stroke colours match the LightBurn palette exactly. Inkscape layer groups are also emitted so files read cleanly in Inkscape. |
| Material modes | Both, eventually. (1) Thick panels (ply/acrylic) in R1. (2) Thin card/paper nets in R2. |
| Panel joint styles | All four eventually. Order: **butt/inset first (R1)**, then bevel, internal frame, finger joints. |
| Butt joint geometry | **Square cuts, inner corners meet.** (Revised 2026-11-11: the original "outer faces meet at the true edge" is impossible with square cuts on a convex solid, because full-size panels would overlap at the inner corner.) Each panel's outer face lies on its face plane, and each edge is inset by t·tan(V/2), with V = 180° − dihedral, so neighbouring panels touch along their inner corners, on the plane bisecting the dihedral angle. A V-groove of angle V opens on the **outside**, 2·t·sin(V/2) wide at the surface (about 41.8° and 2.1 mm for 3 mm material on an icosahedron). The map keeps its true-face projection and is clipped to the inset panel, so it lines up across the groove; the groove strip is not engraved. Panels touch only along a line, so the docs recommend a glue/epoxy fillet in the inside corner, or an internal frame once available. Bevel (mitre) joints are the only way to get an outer surface that matches the polyhedron exactly. |
| Kerf | Optional outward offset of the cut path by kerf/2. **Off by default**, so users can rely on LightBurn's own offset. Default value 0.15 mm. Engraving is never offset. |
| Engraving style | Fully configurable per layer: stroke and/or fill, colour, LightBurn layer. |
| Map layers | Coastlines, country borders, rivers, lakes, land, optional ocean (face minus land), graticule. No text labels in R1. |
| Data resolution | User-selectable: 110m or 50m, both bundled. 50m is the default. 10m was dropped (2026-11-10): no visible benefit at laser scale for its size. |
| Model sizing | Edge length in mm, with the resulting circumsphere diameter shown alongside. For custom shapes with unequal edges, the **longest edge** = N mm. One global scale applies to all faces. |
| Default LightBurn colours | Cut = layer 02 `#FF0000`. Engrave lines (coast/borders/rivers) = 00 `#000000`. Engrave fills (land/lakes/ocean) = 01 `#0000FF`. Score/graticule = 03 `#00E000`. All editable. |
| Face orientation in SVG | **North-up:** each panel is rotated so the local north direction at the face centre points up. If a pole is on or very near the face centre, the longest edge goes on the baseline instead. |
| File naming | `<shape>_face-NN.svg` (zero-padded face index from the polyhedron definition; the same number appears in the 2D and 3D previews). ZIP: `<shape>_faces.zip`, which includes `project.json`. |
| Globe rotation | Drag the globe in the 3D preview (arcball). Stored as a quaternion and shown read-only as lon/lat/roll, with a reset button. |
| Persistence | localStorage autosave (debounced), plus import/export of a versioned project JSON. Custom polyhedra are embedded in the project file. |
| Performance | Projection runs in a **web worker from R1**. While dragging, the linework is drawn live on the GPU (shader applies the rotation and radial projection); the exact worker projection replaces it when the drag ends. Shapes with > 128 faces fall back to 110m worker previews. |
| Testing | Vitest unit tests plus fast-check property tests for all core geometry. |
| Assembly aids | None in R1. |
| Timeline | No deadline; hobby pace, milestone-driven. |

---

## 4. Core algorithm

### 4.1 Normalise the polyhedron
1. Weld vertices (tolerance 1e-6 × bounding-box diagonal).
2. Merge adjacent coplanar faces (normal angle < 0.01°) into single polygons, and remove collinear vertices. Most OBJ exporters triangulate, so this step is required.
3. Validate:
   - closed 2-manifold: every edge is shared by exactly two faces
   - faces are planar
   - convex: every vertex is on or behind every face plane
4. Orient faces CCW as seen from outside.
5. Translate the vertex centroid to the origin. The projection centre must be strictly inside the solid; this is guaranteed for convex solids.
6. Compute per face:
   - **unit plane normal `n`**
   - **plane distance `d`** from the origin
   - in-plane orthonormal basis `u`, `v`
   - edge adjacency, and the dihedral angle per edge

**Important:** use the face *plane normal* and *plane distance*, not the direction to the face centroid. The two coincide only for regular solids. Do **not** assume an insphere touching every face. The truncated icosahedron has none: with edge length 1, its pentagon planes are about 2.327 from the centre and its hexagon planes about 2.267. Each face uses its own `d`.

### 4.2 Prepare map data (once per dataset)
- **Linework** (anything that gets stroked) is built from shared arcs, never from polygon outlines:
  - coastlines = mesh of the land layer
  - borders = `topojson.mesh(countries, (a, b) => a !== b)`
  - rivers
- **Polygons** (fills only): land, lakes. Ocean is derived per face.
- **Densify in lon/lat** using linear interpolation, with a default maximum step of 0.5°. Natural Earth geometry is authored as planar lon/lat data, so densifying keeps lines along parallels the right shape: the US/Canada border at 49°N, Antarctica's edge, graticule parallels. Gnomonic projection itself needs no densifying, because great-circle segments already project to straight lines.
- Convert lon/lat to unit vectors and work in 3D from here on. This removes antimeridian and pole problems from the projection maths.
- **Normalise ring winding** to one convention on load. On a sphere, a ring splits the surface in two, and only the winding says which side is inside. RFC 7946 GeoJSON uses CCW exteriors, while d3 and `world-atlas` use the opposite spherical convention. Test with a ring that covers more than a hemisphere.

### 4.3 Per rotation
Apply the globe-rotation quaternion to all vectors.

### 4.4 Per face
1. **Cull** features whose bounding cone doesn't intersect the face cone.
2. **Clip on the sphere** against the face cone. Each face edge, together with the origin, defines a plane through the origin, which is a great circle. Clip against those half-spaces in 3D **before** projecting.
   - Polylines: segment–plane intersection.
   - Polygons: spherical Sutherland–Hodgman. Use this for **fills only**, because on concave polygons it leaves zero-width bridge edges along the clip boundary.

   Because gnomonic projection maps great circles to lines, this is exactly equivalent to clipping against the face polygon in 2D. It never projects anything near the horizon, and it correctly handles rings larger than a hemisphere (Antarctica, ocean).
3. **Gnomonic projection** onto the face plane: `x = d·(p·u)/(p·n)` and `y = d·(p·v)/(p·n)`, multiplied by the global model-to-mm scale.
4. **Planar clean-up** with Clipper2 (integer coordinates, mm × 1000): union, fix winding, ocean = face − land.
5. Apply the north-up rotation and margin, round to 0.01 mm, then remove duplicate consecutive points.

Output per face: `FaceArtwork { outline, layers: { [layerId]: { polylines, polygons } } }`, independent of the UI.

**Why edges match:** projection is radial from a single centre, so a point on a shared 3D edge projects to the same place from both faces. This holds for any convex solid, regular or not.

---

## 5. Known pitfalls & fabrication notes

- **Antimeridian and pole seams:** Natural Earth polygons are cut at ±180° (Russia, Fiji, Antarctica), and Antarctica has a degenerate edge at −90°. Stroking polygon outlines would engrave false lines there, so linework always comes from meshes (§4.2).
- **Clip-boundary edges:** clipping polygons creates new edges along the face boundary. These must never be stroked, or there would be an engraved line just inside every cut.
- **Gnomonic distortion** grows toward face corners. It is fine on an icosahedron or soccer ball, noticeable on a cube, and severe on a tetrahedron (27× areal and 9× radial scale at the corners compared with the centre; areal scale is (r/d)³). The UI shows a per-shape distortion warning.
- **Clipped polygons** must stay closed and correctly wound for fill engraving.
- **Float noise:** keep SVG coordinates in mm, rounded to 0.01 mm (well under laser precision), then remove duplicate points.
- **Material thickness:** flat panels don't meet at the mathematical edges unless the joint accounts for thickness. Engraving is always projected onto the **outer** surface. With square-cut butt joints (R1) the outer surface is the true face inset per edge by t·tan(V/2); engraving is clipped on the sphere to that inset panel's cone (exact, since gnomonic projection maps those planes to the panel edges).
- **Kerf:** the laser removes about 0.1–0.2 mm. Offset the cut outward by kerf/2 if enabled; never offset engraving.
- **LightBurn assigns layers by exact stroke colour**, not by SVG groups. Colours must be exact palette values. Inkscape uses `inkscape:groupmode="layer"` groups, and both are emitted.
- **Disputed borders:** Natural Earth's default point-of-view dataset is used and documented.

---

## 6. Functional spec (Release 1)

### 6.1 Polyhedron
- Presets are generated in code, not from hand-typed coordinates.
- JSON import: `{ "vertices": [[x,y,z],…], "faces": [[i,j,k,…],…] }`.
- OBJ import:
  - reads `v` and `f` lines only; normals, UVs and materials are ignored
  - supports negative indices and `f a/b/c` syntax
- Preprocessing and validation as in §4.1, with readable errors (e.g. "not convex: vertex 12 is 3.1 mm outside face 4").

### 6.2 Map data
- Bundled: `world-atlas` 110m and 50m (countries and land), plus Natural Earth lakes and rivers at 110m and 50m. All are converted to TopoJSON at build time by `scripts/build-data.ts`.
- Graticule: generated with `d3.geoGraticule`, configurable interval (default 15°), densified.

### 6.3 Panel geometry
- Cut outline = true face polygon with each edge inset by t·tan(V/2) for its own dihedral angle (square-cut butt joint, inner corners meeting). Mixed-dihedral solids get different insets per edge, so this is computed by intersecting the offset edge lines, not with a uniform offset.
- Optional kerf offset: Clipper2, mitre joins, applied to the inset outline.
- The info panel shows, per dihedral group: dihedral angle, V angle, edge inset and outer groove width. It also shows material thickness, edge length and circumsphere diameter. The enlarged-face dialog lists true and cut length per edge.

### 6.4 Layers & laser settings
- Layers: cut outline, coastlines, borders, rivers, lakes, land, ocean, graticule.
- Per layer:
  - enabled
  - mode: stroke, fill or both
  - LightBurn colour, chosen from a picker limited to LightBurn's palette
  - preview stroke width
- Defaults as in §3. Settings are saved in the project JSON.

### 6.5 SVG export
- `width="{w}mm" height="{h}mm" viewBox="0 0 {w} {h}"`, with a 1 mm default margin.
- One `<g inkscape:groupmode="layer" inkscape:label="…">` per layer.
- Strokes are 0.1 mm (LightBurn ignores stroke width for line mode). Fills use `fill-rule="evenodd"`.
- Per-face SVG download, and a ZIP of all faces plus `project.json`.

### 6.6 UI
- **Left panel:**
  - shape picker and import
  - edge length (mm), material thickness, kerf
  - data resolution
  - layer table
  - rotation readout (lon/lat/roll) with reset
- **Centre:** 3D preview (react-three-fiber).
  - Each face is textured with a canvas rendering of its own projected artwork, so it shows exactly what gets exported.
  - Drag rotates the map under the solid; right-drag or modifier-drag orbits the camera.
  - Optional face-number overlay.
- **Right/bottom:** grid of 2D face previews. Click a face to enlarge it and export it on its own.
- **Warnings:** distortion level, polyhedron validation errors, large output.

### 6.7 Non-goals for R1
Paper/net mode, glue tabs, fold lines, bevel/frame/finger joints, nested sheets, DXF, text labels, assembly aids, custom GeoJSON layers, mobile/tablet, non-convex shapes.

---

## 7. Architecture

### 7.1 Stack
| Concern | Choice | Notes |
|---|---|---|
| Build / language | Vite + TypeScript (strict) | |
| UI / state | React + zustand | |
| Styling / components | Tailwind CSS + shadcn/ui (Radix primitives), lucide-react icons | shadcn components are copied into `src/ui/components/ui/` via the shadcn CLI. |
| 3D preview | three + @react-three/fiber + drei | |
| Geo utilities | d3-geo (graticule, lon/lat helpers), topojson-client (mesh, feature) | |
| Planar polygons | **clipper2-ts** | Robust boolean operations plus offsetting (kerf, and later tabs and fingers). Preferred over `polygon-clipping`, which is largely unmaintained and less robust. (`clipper2-js` was the original pick but declares Angular as a peer dependency.) |
| Worker | Web worker + comlink | |
| Export | Hand-written SVG serialiser, JSZip | |
| Testing | Vitest + fast-check | |
| Lint / format | ESLint + Prettier | |
| Visual cross-check | d3-geo-polygon (dev only) | `geoIcosahedral` and `geoCubic` are unfolded gnomonic nets with their own face layout. Useful for eyeballing output, not for automated equality tests. |

### 7.2 Layout
```
src/
  core/                 # pure TS, no DOM; worker-safe; fully tested
    vec3.ts, quat.ts
    polyhedron/         # presets.ts, obj.ts, json.ts, preprocess.ts, faces.ts
    geo/                # topojson load, mesh extraction, densify, lonlat<->vec3, winding
    clip/               # sphere-cone clipping (polylines, polygons)
    project/            # gnomonic face projection, scale, north-up orientation
    planar/             # clipper2 wrapper: union, difference, offset, round/dedupe
    export/             # svg.ts, zip.ts, project-file.ts
    pipeline.ts         # prepare -> rotate -> per-face artwork
  worker/
    projector.worker.ts # comlink-wrapped pipeline; caches prepared data per dataset
  ui/                   # React app: zustand store, r3f scene, previews, panels
    components/ui/      # shadcn/ui generated components (button, input, slider, …)
  lib/utils.ts          # shadcn `cn()` helper
  data/                 # bundled 110m/50m TopoJSON (generated)
scripts/
  build-data.ts         # fetch + convert Natural Earth -> TopoJSON
tests/                  # vitest unit + fast-check properties
```

### 7.3 Data & file formats
| Stage | Format |
|---|---|
| Map input | TopoJSON (Natural Earth via `world-atlas`, plus lakes and rivers converted at build time) |
| Polyhedron | Internal JSON `{ vertices: [[x,y,z]], faces: [[i,j,k,…]] }`; import from OBJ |
| Project file | Versioned JSON (`schemaVersion: 1`): polyhedron, rotation quaternion, size, material, kerf, layers, colours, resolution |
| Per-face output | SVG in mm (`viewBox` matches real size) |
| Bundle | ZIP of all face SVGs + `project.json` |
| Later | DXF, net SVG, nested sheet SVG |

---

## 8. Milestones

1. **Scaffold:**
   - Vite + React + TS, ESLint, Prettier, Vitest, all running locally
   - Tailwind + shadcn/ui initialised, with a basic app shell (left panel, centre, right grid)
   - data build script
   - render 110m land with plain d3-geo to prove the data pipeline
2. **Core geometry:**
   - vec3/quat and the icosahedron preset
   - face frames (n, d, u, v)
   - gnomonic projection, with property tests
   - sphere-cone clipping for polylines
3. **One icosahedron face, end to end:** coastlines and borders, SVG export in mm. Verify true scale in Inkscape and LightBurn.
4. **All faces + worker:** pipeline in a worker, 2D preview grid, ZIP export.
5. **Custom polyhedra:**
   - JSON and OBJ import, preprocessing and validation
   - remaining presets
   - tests: weld, coplanar merge, convexity rejection, winding
6. **3D preview + globe rotation:** textured faces, arcball drag, quaternion state, low-res preview while dragging.
7. **Polygons & layers:**
   - land, lakes and ocean fills (spherical Sutherland–Hodgman + Clipper2)
   - rivers and graticule
   - layer table, LightBurn colours, Inkscape groups
8. **Panel mode:** thickness, kerf offset, dihedral and V-gap info, north-up orientation, 110m/50m resolution switching.
9. **Deployment:**
   - public GitHub repo setup
   - GitHub Actions workflow: typecheck, lint, test, build, deploy to GitHub Pages on `main`, gated on tests
   - Vite `base` path for Pages
10. **Persistence & polish:** autosave, project import/export, warnings, README and maker docs. → **Release 1**

---

## 9. Acceptance criteria (Release 1)

- **Edge continuity:**
  - For every shared edge, sampled edge points map to the same 3D point from both faces (within 1e-9; property test).
  - Features crossing an edge meet within 0.01 mm when the two panels are laid side by side.
- **Projection correctness:**
  - Total projected face area equals the polyhedron surface area.
  - Each face's normal direction projects to the face origin.
  - Points placed exactly on vertices or edges after rotation land on them.
- **Clipping:**
  - Fill polygons are closed and valid after clean-up.
  - No stroked segments lie along face edges unless they are real map features.
- **No seams:** no engraved lines along the antimeridian or at the poles. Test with faces centred at 180°E and at 90°S.
- **Import:**
  - Triangulated icosahedron and dodecahedron OBJs merge back to 20 and 12 faces.
  - Non-convex and non-manifold inputs are rejected with clear messages.
- **Export:**
  - SVGs open at true mm scale in Inkscape and LightBurn.
  - LightBurn assigns the correct layers from the default colours.
- **Visual check:**
  - No visible gaps or overlaps on the truncated icosahedron in the 3D preview.
  - Output looks consistent with d3-geo-polygon `geoIcosahedral` faces.
- **Performance:**
  - 3D preview runs at ≥ 30 fps while dragging.
  - A full 50m re-projection of all 32 truncated icosahedron faces takes < 2 s on a typical laptop.
- **Local:** `npm run dev`, `npm test`, `npm run typecheck`, `npm run lint` and `npm run build` all succeed locally from a fresh clone.
- **CI (milestone 9):** the same checks pass in GitHub Actions on `main`, and the site deploys to GitHub Pages.
- **UI:** all standard controls are shadcn/ui components styled with Tailwind; there are no hand-rolled buttons, inputs etc.

---

## 10. Open questions / risks

- **Butt joint strength:** square-cut panels touch only along their inner corners. Is a glue fillet sufficient at real sizes, or should the internal frame move earlier?
- **Outer groove:** square-cut joints leave a ~2 mm V-groove on the outside (3 mm material) with no map in it. Acceptable as a visible seam, or should bevel joints move earlier?
- **North-up near poles:** the longest-edge fallback may look inconsistent. Revisit once there is real output.
- ~~**10m data:** check download size and performance.~~ Resolved: dropped; 50m is the finest resolution.
- **LightBurn import quirks:** SVG mm units, group handling and fill import. Verify in milestone 3.

---

## 11. Progress (2026-11-10)

| Milestone | Status |
|---|---|
| 1. Scaffold | Done |
| 2. Core geometry | Done |
| 3. One face end to end | Done; true scale in Inkscape/LightBurn still to be checked by hand |
| 4. All faces + worker | Done |
| 5. Custom polyhedra | Done |
| 6. 3D preview + globe rotation | Done (live GPU linework while dragging, see §3 Performance) |
| 7. Polygons & layers | Done |
| 8. Panel mode | Done (10m dropped) |
| 9. Deployment | Prepared: workflow, `/solid-earth/` base path, MIT LICENSE; awaiting repo and first push |
| 10. Persistence & polish | Done |
| Post-R1: Archimedean presets | Done: all 13 Archimedean solids (incl. chiral snubs), picker grouped by family |
| Post-R1: Catalan presets | Done: all 13 Catalan solids, as polar duals of the Archimedean presets |
| Post-R1: Finger joints | Done (§12): global butt/finger choice, fill/flush tips, clearance; `src/core/joints.ts` |
| Post-R1: Sheet nesting | Done (§13): sheet settings, Nest with progress and Cancel, sheet previews and SVGs, sheets in the ZIP; `src/core/nest/`, `src/worker/nester*.ts`, `src/ui/layout/Sheet*.tsx` |

### Changes from the plan

- **TypeScript ~6.0**, not 7: typescript-eslint supports TypeScript < 6.1, and the plan specifies ESLint.
- **clipper2-ts** instead of clipper2-js (§7.1).
- **10m data dropped**: 110m and 50m only. Old project files saved at 10m open at 50m.
- **Live GPU drag preview** instead of 110m worker re-projection while dragging (§3 Performance).
- **Clipping tolerance is exactly 0**: neighbouring faces' edge planes are exact negations, so
  inside/outside tests are complementary and shared-edge cut points are bit-identical.
- **Seams**: world-atlas coastlines contain antimeridian (±180°) and south-pole edge segments; these
  are removed from linework (never from the graticule).
- **Fill layers** in "stroke" mode draw their shoreline arcs (coastline / lake mesh), never the
  clipped polygon outline (§5 clip-boundary edges). Land fill excludes lakes.
- **Face orientation** in preprocessing propagates winding across shared edges and fixes the sign
  by volume, rather than orienting away from the centroid, so non-convex inputs get the right error.
- **Butt-joint geometry corrected (2026-11-11):** panels are no longer cut at the true face size
  (which would make square-cut panels overlap); each edge is inset by t·tan(V/2) and the
  2·t·sin(V/2) gap is an outer V-groove, not an inner one. Engraving is clipped to the inset panel.
  Thickness and kerf are now both sent to the worker (kerf previously never reached it).
- **Enlarged face** is a dialog (thumbnail click or double-click in 3D), since the centre panel is
  the 3D view; it also lists each edge's neighbour, length and dihedral for assembly.
- **Presets** cover all 13 Archimedean solids, built from their standard Cartesian coordinates
  (snubs use the tribonacci constant / real root of ξ³ − 2ξ = φ; one handedness). The live GPU
  preview supports up to 128 faces (the disdyakis triacontahedron has 120).
- **Catalan presets** are generated as polar duals of the Archimedean presets (face plane
  n·x = d → vertex n/d; canonical because Archimedean solids have a midsphere), scaled so the
  longest edge is 1. Tests check the insphere, a single dihedral angle and congruent faces.
- **Name:** the app is **Solid Earth** (repo `solid-earth`); project files use
  `app: "solid-earth"`.
- **Project files** carry `preset` (rebuilt from code on load) alongside the embedded polyhedron;
  import is tolerant (invalid fields fall back to defaults with notes).
- **Sheet nesting (§13)** changed from its first plan in these ways (details in §13.6):
  - parts are convex hulls, not true shapes;
  - the budget is a generation count, now defaulting to 10 × 20;
  - nester progress uses plain worker messages, not comlink;
  - the sheet outline defaults to off;
  - project files gain `nest` and `nestLayout` without a schema bump.
- **3D view error boundary (2026-11-13):** if WebGL is unavailable, the centre panel shows
  "3D preview unavailable" with a retry. Before, the whole app unmounted to a blank page. Found
  while testing nesting in headless Chromium.

### Outstanding manual checks (§9)

(Resolved 2026-11-12: LightBurn palette values 00–29 in `src/core/layers.ts` match the official
LightBurn colour palette reference exactly.)

- SVGs open at true mm scale in Inkscape and LightBurn; LightBurn assigns layers from the default
  colours, including filled paths.
- ≥ 30 fps while dragging; no visible gaps on the truncated icosahedron; visual comparison with
  d3-geo-polygon `geoIcosahedral`.
- CI and Pages deployment (milestone 9).
- Sheet SVGs in LightBurn: true scale, layer assignment, and the T1 sheet outline landing on a
  tool layer with *Allow importing to Tool Layers* on (and on layer 05 with it off).
- Sheet nesting with WebGL on: the UI was driven end to end in headless Chromium, which has no
  WebGL, so the 3D-view fallback showed. Worth one pass in a normal browser.

---

## 12. Finger joints (scoped and implemented 2026-11-11)

The main goal is **strength and alignment**: panels lock into place, and glue gets far more
area than the butt joint's single inner-corner line. Appearance comes second.

### 12.1 Geometry constraint

Square (laser) cuts only mate perfectly at a 90° dihedral. On any other edge, a finger's
square-cut end crosses the neighbouring panel at the angle V = 180° − dihedral. Each finger then
has to accept one of three flaws: it sticks out past the outer surface, it leaves a small wedge
gap, or it stops short. Along the edge itself, finger and slot widths match exactly at any angle.

The two panels overlap over a length of about t / sin(V). For 3 mm material that is 3 mm on a
cube, 4.5 mm on an icosahedron and about 11 mm on the disdyakis triacontahedron (V ≈ 16°), so
fingers get long and thin at shallow joints.

### 12.2 Decisions

| Topic | Decision |
|---|---|
| Joint selection | One **global** joint type: butt (default) or finger. No per-edge overrides yet. |
| Which edges | **Every edge**, whatever its angle. No cut-off and no warning. The only exception is an edge too short for two fingers once the corner clearances are taken off; it stays a butt joint (§3 Butt joint geometry). |
| Finger tip | Two modes: **Fill joint (sand flush)**, where fingers fill the overlap and stick out slightly, to be sanded off; and **Flush**, where nothing sticks out and small wedge gaps open beside each finger. |
| Finger size | **Fixed width in mm** for every finger. Default about 10 mm (roughly 3× thickness). |
| Pattern | **Even number of segments per edge.** Each panel takes the even-numbered segments counting counter-clockwise from its own side. The patterns always interlock, no edge needs a global assignment, and congruent faces (e.g. every Catalan solid) still give identical panels. Leftover length is split equally between the two ends. |
| Corners | **Computed clearance** per edge end, plus a small margin, so fingers never collide where 3+ panels meet. The ends of each edge stay as plain butt joint. |
| Fit | Adjustable **clearance**, which can go negative for a press fit. Default slip fit of about 0.1 mm per side. |
| Kerf | **Independent of clearance.** Clearance shapes the fingers; kerf compensation (if on) then offsets the whole cut path as now. |
| Engraving | The map covers the **whole cut shape**, right into each finger, including tips that reach past the true edge. (Revised 2026-11-11; originally clipped at the true edge.) Past the edge, the panel's own gnomonic projection simply continues, so a finger tip carries the map from the neighbouring panel's slot area it covers. Fill-mode tips sit above the neighbour's surface, so sanding them flush removes that engraving too; it is only visible on tips left proud. |

### 12.3 Out of scope for the first version

Test-fit coupon, shallow-edge warning, edge labels, a 3D preview of the real fingered panels,
per-edge joint overrides.

### 12.4 Design work before implementation

1. **Tip geometry.** Work out finger length and slot depth in cross-section for each tip mode.
   Tests check that no material overlaps and that the flaw lands where the mode says.
2. **Clipping engraving to a non-convex outline.** A fingered panel is no longer convex, so
   clipping on the sphere against the panel's cone planes isn't enough on its own. Clip on the
   sphere to the true face as now, then clip in 2D to the fingered outline with Clipper2, which
   handles open polylines.
3. **Corner clearance.** How far each edge's overlap region reaches into the neighbouring
   edges' overlap regions at a vertex. It needs care on solids with mixed dihedral angles.
4. **Defaults.** Confirm the finger width and clearance defaults against real cuts.

### 12.5 Implementation notes

- **Cross-section** (`fingerProfile`). Positions are measured in the face plane, inward from the
  true edge, with negative meaning beyond it. Finger tip: `min(0, t·cot θ)` (fill) or
  `max(0, t·cot θ)` (flush). Notch depth: the smallest value that clears the finger, found by
  testing every axis that can separate the two cross-sections. For obtuse joints that comes to
  t·sin θ (flush) or t / sin θ (fill). At 90° both modes give an ordinary box joint. Clearance
  is added to the notch depth, and also narrows fingers and widens slots along the edge.
- **Acute joints (θ < 90°)**: square cuts can't close the outer surface even in fill mode. The
  neighbour's notch face leans the wrong way, so a gap of t·cot θ stays open (about 1.06 mm for
  3 mm material on a tetrahedron). Obtuse joints close completely. Both modes leave a small
  triangular void on the inside (a glue pocket).
- **Corner clearance** (`cornerClearance`) is conservative. It keeps each joint's whole overlap
  band clear of (a) the band of the face's other edge at the vertex, in both face planes, and
  (b) the full slab of every other face at the vertex, plus 0.5 mm and the clearance. Typical
  values with 3 mm material: 3.7 mm (cube), 8–8.5 mm (truncated icosahedron, rhombic
  triacontahedron), 10.1 mm (icosahedron). A tighter test against the actual finger and notch
  shapes could fit an extra finger pair on short edges.
- **Engraving**: in finger mode it is clipped on the sphere to the cone of `fingerReach` (the face
  pushed outward on each edge by how far the fill-mode tips reach past it, which is convex and
  contains the whole panel), then in 2D (Clipper2, open paths for lines) to the cut outline.
  Culling uses that polygon's cap. Lines entirely inside a convex safe interior skip the 2D clip.
  Radially, a fill-mode tip (reaching about 3.35 mm past the edge on an icosahedron with 3 mm
  material) shows the neighbour's map out to about that distance, while the neighbour's slot runs
  to about 4.5 mm. The roughly 1 mm in between falls on the finger's square-cut end and can't be
  engraved. 50m, all layers, truncated icosahedron: about 565 ms against 364 ms for butt.
- **Default tip**: fill (strength first, §12).
- **Tests** (`tests/core/joints.test.ts`): cross-section properties over random dihedral angles
  (no overlap, notch as shallow as possible, flush never crosses the neighbour's outer surface,
  fill closes it when θ ≥ 90°, gap = t·cot θ when acute); a 3D check that no finger sample
  point lies inside any other panel, across 8 shapes and two finger widths; outlines are simple;
  layouts match on both panels; congruent Catalan faces give identical panels; and engraving
  stays on the outer surface.

---

## 13. Sheet nesting (scoped 2026-11-12)

Lay every panel's cut outline out on one or more sheets of a size the user chooses, and export
one SVG per sheet that is ready for the laser. The main goal is **material yield**: as few sheets
as possible, with the leftover kept as one usable offcut.

### 13.1 Decisions

| Topic | Decision |
|---|---|
| Algorithm | **No-fit-polygon (NFP) nesting of each panel's convex hull**, with a genetic optimiser over placement order and rotation (Deepnest-style). Butt-joint panels are already convex. For finger-joint panels the hull only gives up finger-in-slot interlocking on the sheet, which wouldn't happen anyway with equal finger sizes. |
| Rotation | A user setting: **free** (configurable step, default 15°), **90° steps**, **180° only** or **none**. "None", "90°" and "180°" are measured from **north-up**, so with "none" panels sit exactly as in the face previews (and grain runs consistently relative to the map). Panels are never mirrored: the engraved side must stay up. |
| Budget | A **fixed number of generations** (configurable), not a time limit, so a given input and seed always produce the same layout. Progress is shown as a bar (generations done / total), without a time estimate. |
| Objective | Fewest sheets first. Then, within each sheet, **push parts toward one edge** (left), so the offcut is one large strip and the last sheet stays mostly empty. |
| Sheet size | Width × height in mm, plus **presets** (§13.3). One size for every sheet in a job. |
| Spacing | **Minimum gap** between panels (default 2 mm) and **sheet margin** (default 5 mm), measured on the final cut path, after finger joints and kerf. Panels never share a cut line. |
| Oversize panels | Nest what fits. Any panel that fits at no allowed rotation goes on an **unplaced** list with a warning, and is left out of the sheet SVGs. |
| Labels | None. |
| Trigger | A **Nest** button. The layout is saved in the project file and autosave. Changing anything that affects outlines or the sheet (shape, edge length, thickness, kerf, joint settings, sheet settings) marks it **stale**. In the restricted rotation modes, changing the globe rotation also marks it stale, because north-up changes. Other artwork-only changes (layers, styles, resolution, and globe rotation in free mode) re-render the sheets without re-nesting. |
| Output | A **Sheets** tab next to the face grid, with per-sheet preview and SVG download. The ZIP adds `<shape>_sheet-NN.svg` alongside the face SVGs and `project.json` when the layout is current. Sheet SVGs use the same layers and LightBurn colours as face SVGs. |
| Sheet outline | A sheet-boundary rectangle in its own **non-output** layer and colour (a LightBurn tool layer), for positioning on the bed. |

### 13.2 Out of scope for the first version

Spare copies, nesting a subset of faces, yield and cut-length statistics, mixed sheet sizes,
common-line cutting, labels, non-convex (true-shape) nesting, and parallel evaluation across
several workers.

### 13.3 Design notes

- **Reference frame.** Placements are rigid transforms (θ, x, y) from a panel's *reference frame*
  to the sheet. In free mode the reference is the face's own (u, v) frame, which doesn't depend
  on the globe rotation, so rotating the globe never invalidates the layout. In the restricted
  modes the reference is the north-up export frame (`FaceArtwork.rotation` applied), and the
  input key includes the globe rotation, so rotating the globe marks the layout stale.
  Rendering composes the placement with the artwork's export rotation either way.
- **Parts.** Each part is the convex hull of its cut outline (after kerf), offset outward by
  gap/2 with mitre joins, which keeps it convex. The sheet's usable area shrinks by
  margin − gap/2. Coordinates are Clipper2 integers (mm × 1000), the same as `src/core/planar`.
- **NFP.** For convex A and B, NFP(A, B) = A ⊕ (−B) is a convex polygon. It is computed directly
  by merging the two edge lists sorted by angle, in O(n + m), with no Minkowski library call and
  no holes. The **inner-fit polygon** of a rectangular sheet is a rectangle, worked out directly.
- **NFP cache.** NFP(A@α, B@β) = R(α) · NFP(A@0, B@(β − α)), so each pair of distinct shapes only
  needs one NFP per *relative* angle. Congruent panels (e.g. all 20 icosahedron faces, every
  Catalan face) are found by matching cyclic edge-length and angle sequences of the hulls, and
  share a canonical shape plus a rotation offset. Catalan solids nest as one shape, and most
  Archimedean solids as two or three.
- **Placement.** Parts are placed one at a time in the given order and rotation. The feasible
  region for a part on a sheet is IFP − ∪ NFP(placed, part), computed with Clipper2 (the union is
  non-convex even though each NFP is convex). Candidates are the vertices of that region; the
  one with the smallest x wins, then the smallest y. A part that fits on no open sheet opens a
  new one.
- **Fitness.** First the number of sheets, then the sum over sheets of the largest x used, with
  the last sheet weighted most. Unplaceable parts are found once, up front, and excluded.
- **Optimiser.** A genetic algorithm over (order, angle per part). The first individual is
  greedy, largest area first, using each part's best angle. It uses order crossover, swap and
  angle mutations, and a seeded PRNG (mulberry32). Defaults (tuned in step 6, §13.6): population
  10, **20 generations**. The best individual is kept between generations, so more generations
  never give a worse result.
- **Sheet presets** (W × H, mm): A4 297 × 210, A3 420 × 297, 12 × 12 in 305 × 305,
  12 × 24 in 610 × 305, 300 × 200 (K40-class bed), 400 × 400 (common diode bed), 495 × 279
  (Glowforge), 600 × 400, 900 × 600, 1200 × 600 (half sheet / large CO₂ bed), plus Custom.

### 13.4 Implementation steps

1. **Panel outlines without artwork.** Expose a function that returns each face's cut outline
   (after kerf) in face-frame mm, plus its north-up angle, without projecting any map data.
   Factor it out of `buildFaceArtwork` / `src/core/panel.ts` / `src/core/joints.ts` as needed.
   Test that it matches `FaceArtwork.cutOutline` rotated back by `FaceArtwork.rotation`.
2. **Settings and types** (`src/core/settings.ts`, `src/core/nest/types.ts`): `NestSettings`
   (sheet W/H, preset id, gap, margin, rotation mode and step, generations, population, seed)
   inside `ProjectSettings`. `NestLayout { inputKey, sheetCount, placements: { face, sheet, x,
   y, angleDeg }[], unplaced: number[] }`. `nestInputKey(settings)` is a stable hash of
   everything that affects outlines or the sheet, plus the globe rotation in restricted
   rotation modes. Project-file parsing is tolerant: older files get defaults and no layout. The
   schema version stays 1 because the change only adds fields.
3. **Part preparation** (`src/core/nest/parts.ts`): convex hull, gap offset, the allowed angle set
   per rotation mode, congruence detection to canonical shapes, and the oversize check against
   the IFP. Tests: each part contains its cut outline and stays convex; congruent faces are
   detected on the icosahedron, truncated icosahedron and a Catalan solid, and distinct shapes
   are not merged.
4. **NFP and IFP** (`src/core/nest/nfp.ts`), with the relative-angle cache. fast-check
   properties over random convex polygons: B placed strictly outside NFP(A, B) never overlaps A;
   B placed strictly inside always does; B on the boundary touches A with zero overlap area; the
   result equals the convex hull of all pairwise vertex sums.
5. **Placement** (`src/core/nest/place.ts`): a deterministic placement for a given order and
   angles, and fitness. Tests: no pair of placed parts overlaps (pairwise Clipper intersection
   area 0), every part lies inside the margin, the gap holds between cut outlines, every face is
   placed exactly once or listed as unplaced, and the result is deterministic. A known case is
   checked too: 20 icosahedron triangles on a sheet that fits exactly N rows must use N rows.
6. **Optimiser** (`src/core/nest/optimise.ts`): the GA with a generation count, seed and progress
   callback. Tests: never worse than the greedy start; identical results for identical input and
   seed; on a few small cases it reaches a known optimal sheet count.
7. **Nester worker** (`src/worker/nester.ts` + `nester.worker.ts`, plain messages; see §13.6). It is separate
   from the projector, so previews stay responsive while nesting runs. It reports progress
   (generation, best sheet count) and can be cancelled. A client sits next to
   `src/ui/projector-client.ts`.
8. **Sheet SVG** (`src/core/export/svg.ts`): refactor `faceToSvg`'s layer-body builder to take
   a 2D transform, then add `sheetToSvg(sheet, placedArts, styles)`, which writes all panels into
   one set of layer groups, plus a sheet-outline layer. Add a `sheet` layer id with a tool-layer
   colour to `src/core/layers.ts`, after checking which colour LightBurn treats as non-output.
   Tests: true mm size and viewBox, every cut path inside the sheet, one group per layer, and
   panel artwork equal to the face SVG's after transformation.
9. **Projector integration** (`src/worker/projector.ts`): `ProjectRequest` takes an optional
   current layout, and `ProjectResult` returns `sheetSvgs`. Artwork is cached, so a layout change
   only re-serialises SVG.
10. **ZIP** (`src/core/export/zip.ts`): include `<shape>_sheet-NN.svg` when the layout is
    current. If it is stale, leave the sheets out and warn.
11. **UI:**
    - Left panel "Sheet" section, built from shadcn Select, Input and Slider: preset, W/H, gap,
      margin, rotation mode and step, generations.
    - `FacesPanel` becomes shadcn Tabs: Faces | Sheets.
    - Sheets tab: Nest button, a progress bar over the generations with Cancel, and a stale
      badge. Below them sit sheet previews (click to enlarge), per-sheet download, and the
      unplaced list.
    - `Warnings.tsx`: unplaced panels and a stale layout.
12. **Docs and plan:** README maker notes (sheet presets, gap vs kerf, grain and rotation mode),
    plus §11 progress and changes. *(Done: a "Sheets" section in `docs/MAKING.md`, README
    features and layout.)*

### 13.5 Resolved in review (2026-11-12)

1. Restricted rotation modes are measured from **north-up**; free mode uses the face frame.
2. The budget is a **generation count**, with a plain progress bar and no time estimate.
3. Nesting uses **convex hulls**. Interlocking fingers on the sheet isn't needed.
4. Bed presets: the standard list in §13.3.

### 13.6 Implementation notes

- **Part preparation** (`src/core/nest/parts.ts`, `convex.ts`). Each distinct shape has one
  canonical polygon, centred on its centroid so that symmetry rotations about the origin map it
  onto itself. Each part stores (φ, t), with reference polygon = R(φ) · canonical + t.
- **Orientations** are `{ alpha, theta }` pairs. `alpha` is the canonical angle the nester uses,
  deduplicated modulo the shape's rotational symmetry. `theta` is the panel's real rotation, one
  of the angles the rotation mode allows. Both give the same outline, but only `theta` keeps the
  engraving the right way round: a triangle in "none" mode must not come back rotated by 120°.
  In free mode the step grid sits on the canonical frame, so every congruent part shares the
  same alphas. This works because free mode's reference frame is arbitrary anyway.
- **Tolerances.** Kerf offsets go through Clipper's 0.001 mm grid, so congruent hulls differ by
  about that much. Matching uses edge lengths to screen candidate vertex correspondences, then a
  least-squares rigid fit over all vertices, then a per-vertex check at 0.005 mm. Hull vertices
  closer than 0.005 mm to the line through their neighbours are dropped. Both tolerances are
  added to the gap/2 offset, so the gap guarantee stays exact.
- **Congruence results**, for reference. With thickness, every Catalan solid nests as one shape,
  the truncated icosahedron as two (pentagon with 5-fold symmetry, hexagon with only 3-fold
  because its insets alternate), and the snub cube as three. The snub cube's triangles touching
  a square get a deeper inset on that edge but stay equilateral, just smaller.
- **NFPs** (`src/core/nest/nfp.ts`). The convex Minkowski sum merges edges in angle order. The
  cache reduces A's angle modulo A's symmetry period, then takes the relative angle from that
  reduced angle modulo B's period. Mixing the two (pentagon and hexagon) gives the wrong NFP, and
  a test covers it. An icosahedron in free mode needs 8 NFPs in total.
- **Clipper2's `minkowskiSum` is not a valid oracle for filled polygons.** It sweeps the pattern
  along the path's outline. A small pattern leaves a hole, and thin slivers are under-covered even
  on the outer boundary. The double-precision wrapper also rounds. Tests use the exact
  definition instead: the convex hull of the pairwise vertex sums.
- **Placement** (`src/core/nest/place.ts`). Parts go on the first open sheet with room, at the
  leftmost and then lowest vertex of IFP − ∪ NFP. That is computed with Clipper2 integers
  (0.001 mm), with the NFP union grown by MATCH_TOL + 2 units first. That covers the cache's
  symmetry-reduced angles (accurate only to MATCH_TOL) and integer rounding, so padded parts
  never overlap. Part padding is gap/2 + HULL_TOL + 2 × MATCH_TOL; the second MATCH_TOL covers
  θ + φ ≡ α holding only modulo the symmetry period. Fitness = sheet count + (last sheet's used
  width + 0.1 × the earlier sheets' widths), normalised to [0, 1).
- **Placement cost** (finger joints, 600 × 400 sheet, warm NFP cache): icosahedron about 8 ms,
  truncated icosahedron about 18 ms, rhombic triacontahedron about 14 ms, and disdyakis
  triacontahedron (120 parts) about 113 ms. The disdyakis triacontahedron nests as two shapes,
  because half its faces are mirror images and panels can't be flipped. At the default budget of
  20 × 50 = 1,000 placements that is 8 s, 18 s and about 2 minutes, so it needs addressing in
  step 6 (next note).
- **Placement speed-ups (step 6)**, all exact; a test checks them against the plain algorithm on
  random arrangements:
  - Each NFP is cached already grown (a mitred convex offset), and a single Clipper `difference`
    replaces union, then inflate, then difference.
  - The search runs in a window spanning the sheet's full height, starting from the left, that
    doubles until it finds space. Only obstacles reaching into the window are clipped.
  - Per sheet and shape/angle, the last leftmost x is remembered and becomes the next window's
    start (Infinity once the shape doesn't fit). This is valid because the free region only
    shrinks.

  Per placement this gives about 5 ms for the icosahedron, 11 ms for the truncated icosahedron,
  12 ms for the rhombic triacontahedron and 120 ms for the disdyakis triacontahedron. The rest is
  per-call overhead in Clipper (about 0.4 ms per `difference`). Many calls are empty windows for
  shape/angle pairs not seen before.
- **Optimiser (step 6)** (`src/core/nest/optimise.ts`). Deepnest-style:
  - the population is the greedy individual plus its mutations;
  - the best individual is kept unchanged each generation;
  - the rest are bred from rank-weighted parents (index ≈ size · (1 − √u)), using single-cut
    order crossover in which each part keeps its parent's angle;
  - mutations are adjacent swaps and angle changes at a rate of 0.1;
  - results are cached by individual, so the kept best and any duplicates are placed only once.

  The **default budget was lowered to population 10 × 20 generations.** Whole runs with finger
  joints on 600 × 400 take about 0.5 s (icosahedron), 1.4 s (truncated icosahedron), 1.3 s
  (rhombic triacontahedron) and 12 s (disdyakis triacontahedron, 120 parts), and always improve
  on the greedy start. If the large Catalans need it later, the next step is a Clipper-free
  candidate-point search for the leftmost free position, or parallel workers.
- **Nester worker (step 7).** Each job gets its own worker, and cancelling terminates it. The
  optimiser loop is synchronous, so a cancel message couldn't be received mid-run. A shared
  memory flag would need cross-origin isolation (COOP/COEP headers), which GitHub Pages can't
  send. Progress, result and errors are **plain messages on the worker's one channel**
  (`serveNest`), not comlink. A comlink callback uses a separate MessagePort, and order across
  ports isn't guaranteed, so progress arrived after the result in testing. `startNest` cancels
  any job still running, and also rejects on the worker's `error` event (script load failure).
  `nestRequest(settings)` sends the same panel inputs as the projector, and the input key that
  `currentLayout` checks.
- **Sheet SVG (step 8)** (`src/core/export/svg.ts`). `faceToSvg`'s layer markup now comes from a
  shared `layerPaths(art, styles, strokeMm, toSvg)`; its output was checked byte-identical
  before and after the refactor. `sheetToSvg` merges every panel on a sheet into one group per
  layer, in the same engraving order. `placedToSvg` composes the placement with the artwork's
  export rotation, undoing it first in free mode, then flips y like `faceToSvg`, so panels are
  never mirrored. A test checks every drawn cut path against the nester's own placed reference
  outline in all four rotation modes. Deliberately breaking the free-mode correction makes it
  fail.
- **Sheet outline** is a fixed constant, not a `LayerId`, so it isn't in the layer table. It is
  drawn on LightBurn's **T1 tool layer, `#F36926`**, which is never output (official palette
  reference). **Caveat:** LightBurn only imports onto tool layers with *Allow importing to Tool
  Layers* enabled. Otherwise it maps T1 to the nearest palette colour, layer 05 (`#FF8000`),
  which *is* an output layer. **Decided 2026-11-12:** `NestSettings.sheetOutline`, **off by
  default** and left out of the input key. The README must explain the LightBurn setting.
- **Projector integration (step 9).** `ProjectRequest.sheets = { layout, nest, outline }` adds
  `ProjectResult.sheetSvgs`, or null without a layout or in preview mode. Sheets come from the
  cached artwork, so a new layout or outline toggle only re-serialises SVG. The UI must send only
  a current layout. As a safety net, the projector rejects a layout with faces the shape doesn't
  have.
- **ZIP and warnings (step 10).** Sheets are saved as `<shape>_sheet-NN.svg`, numbered from 01
  like the Sheets tab. `sheetsForZip(settings, sheetSvgs)` (`src/core/nest/status.ts`) includes
  sheets only for a current layout whose rendered SVG count matches its sheet count, so a render
  still in flight never exports the previous layout's sheets. Otherwise it returns a warning
  (stale, or still rendering). `nestWarnings(settings)` reports a stale layout and lists faces
  that don't fit.
- **Clipper rounding at the window edge (fixed in step 10).** The placement property test found
  a padded part 0.00057 mm outside the bin. Clipper rounds the intersection vertices it creates
  to whole units, so one can land a unit outside the window. `leftmostVertex` now clamps the
  chosen vertex into the window. That moves it at most one unit, which NFP_GROWTH's 2-unit
  rounding allowance covers. The counterexample is kept as a regression test, and a soak at 10×
  the usual property runs passes.
- **UI (step 11).**
  - **Left panel:** a "Sheets" section (`SheetSettings.tsx`) with preset, swap W/H, width and
    height, gap, margin, rotation mode and step, generations, and the outline switch. The switch
    explains LightBurn's tool-layer setting when on.
  - **Right panel:** Faces | Sheets tabs (`FacesPanel.tsx`, `SheetsPanel.tsx`). The Sheets tab
    has Nest / Nest again, then a progress bar with generation and best sheet count and Cancel,
    an out-of-date badge, previews with per-sheet SVG download, and `SheetDialog`.
  - **Warnings:** stale layout and panels left off.
  - **ZIP:** uses `sheetsForZip` and toasts when sheets are left out.
  - **`runNesting`** (`src/ui/nesting.ts`) saves a result only if the input key still matches
    when it arrives. `selectCurrentLayout` is a stable store selector, since it returns the
    stored object or null.
  - **`NumberField`** moved to `fields.tsx` and now shows outside changes (presets, opening a
    project) while not focused. Before, it only re-read its value on blur.
  - **Progress** was added via the shadcn CLI.
- **No React error boundary (pre-existing, found while testing).** If WebGL is unavailable, the 3D
  canvas throws and the whole app unmounts to a blank page. An error boundary around the 3D view
  with a "3D preview unavailable" fallback would keep the rest of the app usable.
- **Browser check (step 11/12).** Driven with Playwright and headless Chromium in the
  scratchpad. The sandbox's Chromium needs `--no-sandbox --disable-dev-shm-usage --disable-gpu`
  and has no WebGL, and the dev server must run in the same command as the browser, because each
  sandboxed command has its own network. The run checked:
  - the 3D fallback showed;
  - A3 set 420 × 297;
  - the progress bar showed;
  - 20 icosahedron panels went onto 2 sheets, with previews and dialog correct;
  - changing the gap showed the out-of-date badge and the left-panel warning;
  - restoring it brought the sheets back without nesting again;
  - the ZIP held `icosahedron_sheet-01/02.svg`.

  The only console errors were the contained WebGL failures.
- **Telling panels apart on sheets.** There are no labels (§13.1), so parts are matched to faces
  through the face previews (rotation mode *None* makes them identical). A possible follow-up is
  showing face numbers over the sheet preview in the app only (not exported).
