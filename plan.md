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
3. Bevel joints. **Scoped 2026-11-13; see §14.**
4. Nested sheet export for a given laser bed size. **Done 2026-11-13; see §13.**
5. Internal frame/connector generation.
6. Finger joints. **Scoped 2026-11-11; see §12.**
7. DXF export.
8. Custom GeoJSON layers (e.g. travel routes).
9. Rotation presets and optimiser (e.g. vertex at north pole, minimise land cut by edges).
10. Text labels (needs font-to-path conversion).
11. Optional alternative per-face projection (e.g. azimuthal equidistant), with a warning that edge continuity breaks.
12. Star chart (celestial globe), with optional cut-out stars for a lamp. **Scoped 2026-11-13; see §15.**
13. Moon globe (maria and craters). **Scoped 2026-11-13; see §16.**

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

---

## 14. Sanded bevel joints (scoped and implemented 2026-11-13)

A third joint style. Panels are cut slightly oversize, and the maker sands each edge to a bevel
(a mitre) so neighbouring panels meet at the outer surface with no V-groove. The panels are
still laser-cut square. An engraved **sanding guide** on the front marks where the bevel must
meet the map face.

### 14.1 How it works

Bevel mode is **butt mode at thickness 0, plus an offset cut**. After sanding, the outer faces
of neighbouring panels meet exactly at the true edges, so the front of every panel is the true
face, just as with zero-thickness panels:

1. **Sanding guide (engraved):** the thickness-0 panel outline, i.e. the true face
   (`face.vertices2D`), output as a thin engraved line instead of a cut.
2. **Cut line:** the guide with every edge moved outward by the **sanding allowance**, keeping
   sharp corners (`insetPolygon` with negative insets). Kerf compensation, if on, then offsets
   this cut path as usual.
3. **3D preview:** unchanged. It shows the true face, which is the sanded result.

It differs from thickness 0 in three ways:

- **The map runs out to the cut line** (§14.2), so artwork is clipped to the cut polygon rather
  than the true face.
- **Thickness is still used, but only for checks and information.** It moves no line in the
  SVG. It gives each edge's bevel tilt and back-face width, and the "too thick" check: the back
  face is the butt-mode panel, which must still exist.
- **Nesting uses the larger cut outline.**

**Why it closes.** With dihedral θ, thickness t and V = 180° − θ, each edge's bevel lies on the
plane bisecting the dihedral. It passes through the true edge on the front and meets the back
at the butt line, t·tan(V/2) in (the same polygon as `panelOutline`). Neighbours share this
plane, so panels meet without overlap at edges and corners. The bevel's tilt from square is V/2
(20.9° on an icosahedron, 45° on a cube). The maker sands at V/2 until the front edge reaches
the guide; if the angle is right, the back edge then falls on the butt line.

### 14.2 Decisions

| Topic | Decision |
|---|---|
| Joint selection | A third global joint kind, **Bevel (sanded)**, alongside butt and finger. No per-edge overrides. |
| Guide line | Engraved on the front at the **true face edge**: a closed polygon, the face's own `vertices2D`. |
| Allowance | User setting, **default 2 mm** (originally 0.5 mm; raised 2026-11-13 to leave more room for sanding), accepts 0 ≤ a < 5 mm. At 0 the cut line coincides with the guide. |
| Corners | **Sharp.** Each edge moves straight out, so acute corners reach further (2 × allowance at 60°). |
| Guide layer | A new output layer, **Sanding guide**, LightBurn **04 (`#D0D000`)**, on by default, with its own switch and colour in the layer table. It is only output in bevel mode, and its table row only shows in bevel mode. |
| Map in the allowance | **Runs out to the cut line.** The panel's gnomonic projection simply continues past the true edge, so a slightly under-sanded edge still shows continuous map at the seam. |
| Edge angles | **Table only.** The Panels tab table shows each angle group's bevel tilt and back-face width. The face dialog shows each edge's angle. Nothing extra is engraved. |
| Angle convention | **Tilt from square** (V/2), the value a disc-sander table or sanding jig is set to. |
| Kerf | Unchanged: offsets the cut path (outside the allowance). The guide is engraving, so it is never offset. |
| Nesting | Uses the larger cut outline automatically. The nest input key includes the joint kind and allowance. |

### 14.3 Out of scope for the first version

Engraved per-edge angle labels or group marks, a printable sanding-jig template, per-edge
allowance, showing bevels in the 3D preview.

### 14.4 Implementation steps

1. **Joint options and settings** (`src/core/joints.ts`, `src/core/settings.ts`).
   `JointOptions` gains `{ kind: 'bevel'; allowanceMm }`. `JOINT_KINDS` becomes
   `['butt', 'finger', 'bevel']`. `ProjectSettings.bevelAllowanceMm` (default 0.5) and
   `jointOptions()` map it through. Add `bevelTiltDeg(dihedral) = V/2` beside `vGap`.
2. **Panel geometry** (`src/core/panel.ts`, `src/core/panel-shape.ts`). Add
   `bevelOutlines(frames, face, thickness, allowance)` returning `{ guide, cut }` in model
   units: `guide` is the true face and `cut` is `insetPolygon(face, −allowance)` for every
   edge. It first calls `panelOutline` (the back face) so a too-thick material throws the same
   `PanelError`, with wording that mentions bevels. `panelModelOutline` returns the cut polygon
   in bevel mode, and `PanelShape` gains an optional `guide`. Tests: the guide equals the face;
   each cut edge is parallel to its true edge at exactly the allowance; the cut is convex and
   contains the guide; allowance 0 gives cut = guide; too thick throws; `panelShape` in bevel
   mode matches `FaceArtwork` rotated back (the existing §13.4 step 1 property, extended).
3. **Artwork** (`src/core/pipeline.ts`). In bevel mode the panel is convex but reaches past
   the true edge, so clip on the sphere to `polygonConePlanes(face, cut)`, and cull with
   `polygonCap` of the cut polygon instead of `faceCap`, otherwise lines just outside the face
   would be dropped. No 2D clipping is needed. The ocean fill region is the cut polygon.
   `FaceArtwork` gains an optional `guide` (rounded like the outline). Tests: a meridian
   crossing an edge now ends on the cut line, not the true edge; fills reach the cut line; butt
   and finger output are byte-identical to before.
4. **Layer and SVG** (`src/core/layers.ts`, `src/core/export/svg.ts`). Add `'guide'` to
   `LayerId` and `DEFAULT_LAYER_STYLES` (label "Sanding guide", `#D0D000`, stroke).
   `layerPaths` emits it only when `art.guide` is present. `LAYER_ORDER` becomes fills, lines,
   guide, cut. Sheet SVGs share `layerPaths`, so they pick it up too. Tests: the guide layer is
   present in bevel mode and absent otherwise; its colour maps to LightBurn index 04; the SVG
   bounds come from the cut path.
5. **Persistence and nesting** (`src/core/export/project-file.ts`, `src/core/nest/key.ts`).
   Parse `bevelAllowanceMm` with the default and range check. `parseLayerStyles` already fills
   in missing layers from the defaults, so older files gain the guide layer. The schema stays
   at 1 (additive fields). `nestInputKey` adds `['bevel', allowance]`. Tests: round trip;
   an older file loads with defaults; the key changes with the allowance and with the joint kind.
6. **Worker plumbing** (`src/worker/projector.ts`, `src/worker/nester.ts`, `src/ui/store.ts`).
   Pass the new joint options through, and add `bevelAllowanceMm` and its setter to the store
   and `selectSettings`. Check that the projection reruns when the allowance changes.
7. **UI** (`src/ui/layout/LeftPanel.tsx`, `LayerTable.tsx`, `FaceDialog.tsx`).
   - Joints select gains "Bevel (sanded)". In bevel mode, show the allowance field (mm, step
     0.1) and a short note: sand each edge at the tilt shown until the front edge reaches the
     engraved guide.
   - `PanelInfo` columns in bevel mode: Edges, Dihedral, **Tilt** (V/2), **Back** (t·tan(V/2),
     the bevel's width on the back face). The note under the table explains both.
   - Layer table: the Sanding guide row only in bevel mode.
   - Face dialog: per-edge tilt in bevel mode. Cut lengths show the true-edge length (front
     face after sanding).
   - 3D preview: no change. Its texture covers the true face, which is the sanded result.
8. **Docs.** A "Sanded bevel joints" section in `docs/MAKING.md`: sanding-jig set-up, sanding
   to the guide, running the guide layer as a light line, and checking the angle on a test
   pair. Also update the README features and layer table, the About dialog's Panels step and
   layers list, and record implementation notes in §14.5.

### 14.5 Implementation notes

- `panelModelOutline` became `panelModel(frames, face, thicknessMm, mmPerUnit, joint)`, returning
  `{ outline, guide, fingers }`, so `panelShape` and `buildFaceArtwork` share one switch on the
  joint kind. `PanelShape` and `FaceArtwork` carry `guide` only in bevel mode.
- `bevelOutlines` calls `panelOutline` purely as the back-face check and rewrites its error to
  say "bevels leave no back face".
- Artwork in bevel mode clips to the cut polygon's cone planes and culls with `polygonCap` of the
  cut polygon. At allowance 0 the cut is the guide, so it falls back to the face's own planes and
  cap, exactly as thickness 0.
- The guide layer is drawn under the cut (fills, lines, guide, cut). Its preview-width setting is
  hidden because the 3D texture doesn't draw it.
- The face dialog's third column becomes **Back edge** (the square-cut panel's edge lengths, i.e.
  the back face) and the last two **Bevel tilt** and **Back width**.
- Butt and finger SVG output was checked byte-identical before and after the change (SHA-256 over
  three shapes, both joint kinds, thickness 0 and 3 mm, kerf on and off).

### 14.6 Open points to confirm on real cuts

- Whether the 2 mm default suits 3 mm ply and acrylic, or is more sanding than needed.
- Whether the guide shows well enough on the 3D preview texture's edge to be worth drawing
  there (currently not drawn).

---

## 15. Star chart (scoped and implemented 2026-11-13)

A second **subject**: instead of the Earth, project the night sky onto the solid to make a
celestial globe. Bright stars can be cut right through the panels, so a light inside throws the
sky onto the walls of a room.

Panels, joints, kerf, nesting and export work exactly as for the Earth. Only the data and the
layers change.

### 15.1 How it works

- **Same projection.** The sky data is lon/lat GeoJSON with longitude = right ascension in
  degrees and latitude = declination, so it goes through the existing pipeline (rotate, clip to
  each panel's cone, gnomonic projection) unchanged. Lines and the Milky Way are continuous
  across edges just like coastlines.
- **Which way round.** Panels are seen from outside, so the default gives a **traditional
  celestial globe**: right ascension increases to the right with north up, which is the sky
  mirrored compared with looking up. **As seen from Earth** mirrors the data at load
  (longitude → −longitude), which keeps continuity exact.
- **Lamp projection.** Gnomonic projection keeps every point on its ray from the centre, so a
  light at the centre throws each star hole along its true direction. In the traditional mode,
  the pattern on the walls is the real sky the right way round for someone inside the room.
- **Stars are points.** Each panel draws a star as a circle centred where the star projects onto
  that panel's plane, with a diameter in mm set by brightness. A star near an edge is drawn on
  both panels and clipped to each panel's outline, so the two parts meet at the seam
  (approximately in butt mode, where the inset and V-groove separate them a little).

### 15.2 Decisions

| Topic | Decision |
|---|---|
| Subject switch | **Earth / Sky** picker at the top of the **Map** tab. The layer list below changes with it. Each subject keeps its own layer settings, so switching back loses nothing. Saved in the project file. |
| Handedness | **Traditional** (default) or **As seen from Earth**, a switch under the subject picker. |
| Star data | d3-celestial `stars.6.json` (XHIP, J2000): 5,044 stars to magnitude 6. |
| Star limit | **Magnitude slider**, 3 to 6 in steps of 0.1, **default 5** (1,627 stars; 519 at 4, 5,044 at 6). Replaces *Map data* resolution in sky mode. |
| Star size | **Min and max diameter in mm**, defaults 0.6 mm and 3 mm. Linear in magnitude: magnitude 0 or brighter gets the max, the limit magnitude gets the min. |
| Engraved stars | **Stars** layer with a mode like land: **Fill** (solid dots, default), **Ring** (circle outlines), **Fill + ring**. |
| Cut-out stars | **Star holes** layer, off by default. Stars at or brighter than the **hole limit** (default magnitude 2.5, 93 stars) are cut through. Fainter stars stay engraved. A hole is never smaller than the **minimum hole** (default 1 mm). A star cut as a hole is not also engraved. |
| Holes near edges | **Allowed to notch the outline.** A hole wholly inside the panel goes on the Star holes layer. A hole that crosses the cut outline is subtracted from the outline instead, so the cut layer carries the notch (both panels get their part). Holes may remove part of a finger. |
| Hole cut order | Star holes get their own layer, LightBurn **05 (`#FF8000`)**, written before the cut so LightBurn can cut them first. |
| Other layers | **Constellation lines** (stick figures, line layer), **Milky Way** (outermost outline only, fill layer with Fill / Outline / both), **Celestial grid** (RA/Dec, the sky's graticule, own spacing setting, default 15° = 1 h), **Ecliptic & equator** (two great circles, line layer). |
| Not included | Constellation boundaries (not requested), labels and names (need text-to-path; later, with the text-labels backlog item), deep-sky objects, planets, star colours. |
| Rotation | One globe rotation per project, shared by both subjects. North celestial pole at the top by default (identity). The readout shows **RA** (hours, 0–24 h), **Dec** and roll in sky mode. |
| Shared with Earth | Shape, size, thickness, kerf, joints (including sanding guide), sheets, nesting, export file names, warnings. |

### 15.3 Data and licensing

d3-celestial 0.7.35 (npm, BSD-3-Clause) provides `stars.6.json`, `constellations.lines.json` and
`mw.json`. Its sources: stars from XHIP (Anderson & Francis 2012, VizieR V/137D), constellation
lines from the IAU with the author's changes, and the Milky Way from Jose R. Vieira's Milky Way
Outline Catalog.

- **Milky Way licence (decided 2026-11-13):** the original catalogue's site can no longer be
  found, so the outline is taken as covered by d3-celestial's BSD-3-Clause licence, under which
  it is distributed. Vieira's catalogue is credited in the README and the maker guide; the About
  dialog credits d3-celestial.
- `mw.json` has five nested levels (`ol1`–`ol5`). Keep only the outermost, identified by
  containment rather than assumed from its id.
- `scripts/build-data.ts` copies the pinned package's files into `src/data/` in a compact form:
  stars as `[lon, lat, mag]` triples, constellation lines as a MultiLineString list, and the
  Milky Way outline as rings. README licences and the About dialog credits are updated.

### 15.4 Out of scope for the first version

Constellation boundaries, labels, deep-sky objects and planets, star colours, a dark-sky preview
theme, per-subject rotations, a warning for holes too close together (overlapping holes simply
merge).

### 15.5 Implementation steps

1. **Data** (`scripts/build-data.ts`, `src/data/`, `src/worker/bundled-data.ts`). Add the pinned
   d3-celestial dev dependency and the conversion described in §15.3, with the licence check
   first. Load the sky data lazily in the worker, only when the subject is Sky. Tests: star
   count and magnitude range, every line and ring inside lon/lat bounds, one Milky Way polygon.
2. **Settings** (`src/core/settings.ts`, `src/core/layers.ts`). `ProjectSettings` gains
   `subject: 'earth' | 'sky'`, `skyFlip`, `starMagLimit`, `starMinDiameterMm`,
   `starMaxDiameterMm`, `starHoleMagLimit`, `starHoleMinDiameterMm` and `skyGridIntervalDeg`.
   New layer ids `stars`, `starHoles`, `constellations`, `milkyWay`, `skyGrid`, `ecliptic`, with
   defaults, and an `EARTH_LAYERS` / `SKY_LAYERS` split for the table and export. `cut` and
   `guide` belong to both. Persistence is additive, so the schema stays at 1 and old files open
   as Earth.
3. **Sky linework** (`src/core/geo/sky.ts`). Ecliptic and equator as densified great circles
   (obliquity 23.44°, J2000). The RA/Dec grid reuses `graticuleLines`. The flip is a mirror
   applied while preparing data. Tests: the ecliptic crosses the equator at RA 0 h and 12 h and
   peaks at Dec ±23.44°; flipping is its own inverse and keeps the pole fixed.
4. **Stars in the pipeline** (`src/core/pipeline.ts`, new `src/core/stars.ts`). `PreparedMap`
   gains points (unit vector and magnitude). Per face: keep stars in front of the face within its
   cap widened by the largest star radius, project each one, and build a circle polygon (segment
   count scaled to its size). Split by the hole limit. Engraved stars: fill polygons and ring
   polylines clipped in 2D to the panel outline. Holes: those wholly inside the outline become
   `FaceArtwork.holes`; the rest are subtracted from the outline before kerf. Kerf offsets holes
   inward and the outline outward. Tests: star diameter formula and clamping; a star exactly on
   an edge appears on both panels and the parts meet at the true edge (thickness 0); holes are
   never below the minimum; a crossing hole notches the cut outline and is absent from `holes`;
   kerf shrinks holes by kerf/2; nothing is engraved where a hole is cut; Earth output is
   byte-identical to before.
5. **SVG and texture** (`src/core/export/svg.ts`, `src/ui/three/texture.ts`). Write the sky
   layers, with Star holes before the cut. Draw the sky layers on the 3D preview texture, and
   show holes as see-through (or dark) so a lamp build can be previewed. Tests: layer order and
   colours; a notched outline is still one closed path; sheet SVGs carry holes.
6. **Nesting** (`src/core/nest/key.ts`). Parts already use the convex hull of the cut outline.
   Notches only remove material, so a layout stays valid and the key needn't include sky
   settings. Add a test that a notched panel's hull fits inside the un-notched one.
7. **Worker and store** (`src/worker/projector.ts`, `src/ui/store.ts`,
   `src/ui/useProjectionSync.ts`). Pass the subject, sky settings and star layers through, and
   rerun the projection when any of them change.
8. **UI.**
   - **Map tab:** an Earth / Sky picker at the top. In sky mode, the Traditional / As seen from
     Earth switch, the magnitude slider (showing the star count), min/max star size, and the
     layer table with sky rows. The Star holes row has the hole limit and minimum hole size in its
     settings popover.
   - **Rotation readout:** RA (h), Dec and roll in sky mode.
   - **About dialog:** mention the sky option and the Star holes layer (05).
9. **Docs.** A maker-guide section, "Star chart and lamp", covering handedness, hole sizes, cut
   order (Star holes before Cut), lamp tips (LED only, heat, light leaking at seams), and why
   holes may notch edges. README features, layer table and credits.

### 15.6 Implementation notes

- **Milky Way licence.** The catalogue's page (skymap.com) returns 404 and no other copy of its
  terms could be found, so the outline is taken as covered by d3-celestial's BSD-3-Clause
  licence (§15.3). If that ever proves wrong, drop `milkyWay` and `milkyWayEdges` from `sky.json`
  and the layer.
- **Milky Way geometry (fixed after first review).** Two problems made the fill land beside the
  band instead of in it:
  1. One of the band's two edge rings runs the opposite way to the rest. The source relies on an
     even-odd rule (which `geoContains` uses, so containment looked right), but our fills and
     d3's `geoArea` follow ring direction. The build now orients every ring by containment
     (`orientByContainment`) and checks the band's area (≈ 2.12 sr).
  2. The spherical Sutherland–Hodgman clipper joins a ring's exit and entry points along the
     shorter arc, which assumes rings well within a hemisphere. The band's edges wrap right round
     the sky, so a cone plane cuts them at nearly opposite points and the join can go either way.
     The build now cuts the band into 32 tiles on a 30° grid (d3's equirectangular projection does
     the antimeridian cut, Clipper the tiling) for filling. The 2D union per panel merges them
     back, and the outline stroke keeps the original rings (`milkyWayEdges`), since line clipping
     has no such limit. A test checks the fill against containment point by point, both ways
     round. `sky.json` grew to 476 KB with the tiles.
- **Layers.** Sky line layers (`skyGrid`, `ecliptic`, `constellations`) and fill layers
  (`milkyWay`, `stars`) join the existing line and fill lists, so SVG export and the preview
  texture handle them unchanged. Stars use the fill-layer modes (Fill / stroke / both shown as
  Dots / Rings / Dots + rings), stroking the `starRings` line source. `subjectStyles` switches
  off the other subject's layers in the worker and the 3D view.
- **Constellation lines** are not densified: each segment is a great-circle arc, which gnomonic
  projection maps to a straight line, so the vertices alone are exact. The ecliptic and equator
  are generated as 30° arcs so face culling still works.
- **Stars per panel** are projected as points and drawn as 2D circles (12–72 segments). Holes
  are merged where they overlap, then sorted by Clipper: wholly inside → `FaceArtwork.holes`
  (shrunk by kerf/2), crossing → subtracted from the outline, outside → dropped. Fills (stars
  and Milky Way) and star rings are clipped away from every hole; other linework isn't, since the
  hole cut removes it anyway.
- **Live preview.** Textures are hidden while dragging, so `lineSegments` also returns small
  circles round each star (`starMarkers`), sized from the star diameters, for the GPU preview.
- **Star counts.** The projector reports stars shown and holes cut, and the Map tab displays
  them under the magnitude slider (data-driven, not a table).
- **Earth unchanged.** Earth SVG output was checked byte-identical before and after (three
  shapes, butt, finger and bevel joints, kerf on and off, with coastlines, land, ocean and
  graticule).
- **Speed.** Sky projection takes 0.2–0.5 s for the icosahedron, truncated icosahedron and
  disdyakis triacontahedron, at magnitudes 5 and 6 with holes and the Milky Way on.

### 15.7 Open points to confirm on real cuts

- The default star sizes and the 1 mm minimum hole on 3 mm ply.
- Whether light through 3 mm material near panel corners (where rays meet the panel at a
  slant) still projects clean dots, or whether holes there need enlarging.

## 16. Moon globe (planned and reviewed 2026-11-13)

A third **subject**: the Moon, with the maria and craters. It works like the star chart (§15):
the same projection, panels, joints, kerf, nesting and export, with only the data and layers
changed. Nothing is cut through the panels; for a lamp, engrave on translucent material.

### 16.1 How it works

- **Same projection.** Selenographic longitude and latitude (IAU Moon 2000, east positive)
  go through the pipeline unchanged, as Earth lon/lat does. Maria are polygons like land, crater
  rims are polylines like coastlines, and both stay continuous across edges.
- **No mirror switch.** A Moon globe seen from outside looks the way the Moon looks from Earth
  (north up, Mare Crisium to the east, on the right). The sky needed a flip because its globe is
  seen from the "wrong" side; the Moon doesn't.
- **Craters at true size.** A crater is a small circle on the sphere with angular radius
  (D / 2) / 1737.4 km, generated as a densified polyline and drawn like any other line. Unlike
  stars, crater size scales with the globe.
- **Default view.** The near side faces front with north up: identity rotation, the same
  convention as Earth (lon 0, lat 0 at the front).

### 16.2 Decisions

| Topic | Decision |
|---|---|
| Subject switch | The Map tab picker becomes **Earth / Sky / Moon**. Each subject keeps its own layer settings. Saved in the project file. |
| Maria | **Maria** fill layer (Fill / Outline / both), LightBurn C01, **on by default as Outline** (a full fill is a long engrave; same reasoning as Land defaulting off). |
| Craters | **Craters** line layer (rims), C00, on by default. |
| Crater source | **IAU named craters** from the USGS Gazetteer of Planetary Nomenclature, **including satellite craters** (e.g. "Copernicus A"). |
| Crater limit | **Minimum diameter slider** on the Map tab, in place of Earth's *Map data* resolution and the sky's magnitude slider. Range 10–300 km on a log scale, **default 30 km**. Shows the number of craters drawn. |
| Lunar grid | **Lunar grid** line layer (selenographic lon/lat graticule), C03, off by default, own spacing setting (default 15°), reusing `graticuleLines`. |
| Holes | None. No cut-through layer for the Moon. |
| Rotation | Shared with the other subjects. The readout shows **Lon / Lat / roll**, the same as Earth. |
| Shared | Shape, size, thickness, kerf, joints (including the sanding guide), sheets, nesting, export, warnings. |

### 16.3 Data and licensing

Neither source is on npm. `scripts/build-data.ts` downloads them with `fetchCached` (extended to
binary files and per-source cache folders), converts them, and commits the result as
`src/data/moon.json`, loaded lazily in the worker like `sky.json`.

- **Maria:** LROC global mare boundaries, Nelson et al. (2014), *LPSC 45*, abstract 2861. PDS
  LROC RDR `EXTRAS/SHAPEFILE/LROC_GLOBAL_MARE/LROC_GLOBAL_MARE_180.ZIP` (8.3 MB shapefile,
  65° N to 65° S, which covers every mare; fields `MARE_NAME`, `AREA_KM`). Pin by recording
  the file's SHA-256 in the script.
- **Craters:** Gazetteer `MOON_nomenclature_center_pts.zip` (shapefile, regenerated nightly by
  USGS, so pin by recording the download date and checking the crater count stays within a
  range). Keep features of type *Crater* with a diameter, satellite craters included. Record
  the counts (named and satellite) in the implementation notes. If the Gazetteer turns out not to
  list satellite craters, note it and go on with the named ones.
- **Licences, checked first (step 1):** Gazetteer data is a USGS work (US government, public
  domain); credit the IAU WGPSN and USGS Astrogeology. The LROC page states no licence; PDS
  archives are released without restriction under NASA's data policy, but read
  `LROC_GLOBAL_MARE_README.TXT` and the PDS volume's documents to confirm before bundling. If it
  turns out to be restricted, fall back to mare units from the USGS Unified Geologic Map of the
  Moon (Fortezzo et al. 2020, public domain), which is much larger to process.
- **Format:** `{ maria: MultiPolygon coordinates (d3 winding, merged, simplified), craters:
  flat [lon, lat, diameterKm] triples, largest first }`. The original budget of 300 KB proved
  too tight (§16.7); the result is 429 KB, 148 KB gzipped (the sky is 468 KB, 168 KB gzipped).
- **New dev dependency:** `shapefile` 0.6.6 (BSD-3-Clause) to read `.shp`/`.dbf`. Unzipping
  uses `jszip`, already a dependency. Build time only; nothing new ships to the browser.
- Credits: README data/licences, the maker guide's "About the map", and the About dialog.

### 16.4 Out of scope for the first version

Elevation contours (LOLA), landing sites, labels and names (text-labels backlog item; the crater
names are kept out of `moon.json` for now but are available in the source), cut-through holes,
raster albedo or shaded relief, crater floors as fills, a maximum crater size, libration.

### 16.5 Implementation steps

1. **Licences and data** (`scripts/build-data.ts`, `src/data/moon.json`,
   `src/worker/bundled-data.ts`). Confirm both licences (§16.3). Add the dev dependencies and
   `buildMoon()`: download, unzip, read the shapefiles, rewind maria to the d3 convention with the
   existing `rewind`, simplify, and write `moon.json`. Build-time checks that throw: total maria
   area within a few percent of the published ≈ 16 % of the surface; every ring within lon/lat
   bounds; the crater count is plausible; Copernicus is about 93 km at 9.6° N, 20.1° W. Use
   `orientByContainment` and `tileRegion` from the sky build only if a mare polygon turns out to
   be too large for spherical clipping (Oceanus Procellarum is the candidate; the test in step 3
   decides). `loadMoonData()` as a lazy chunk.
2. **Settings and layers** (`src/core/settings.ts`, `src/core/layers.ts`,
   `src/core/export/project-file.ts`). `Subject` gains `'moon'`; `SUBJECT_LAYERS.moon = ['maria',
   'craters', 'moonGrid']`. `ProjectSettings` gains `craterMinDiameterKm` (default 30) and
   `moonGridIntervalDeg` (default 15), with validators. New ids: fill `maria`, lines `craters` and
   `moonGrid`, line source `mariaEdge`. Persistence is additive (schema stays at 1). Tests:
   subject layer split, old files open unchanged, invalid values fall back.
3. **Moon linework** (new `src/core/geo/moon.ts`). `MoonData`, `MOON_RADIUS_KM = 1737.4`,
   `craterRims(craters, minDiameterKm)` → small circles on the sphere as `Vec3[][]`, segment count
   scaled to size (24–96), split into arcs short enough for face culling, as with the ecliptic.
   Tests: every rim point at the right angular distance from the centre; the filter respects the
   minimum; a rim crossing the antimeridian or near a pole stays whole. Pipeline test (as for the
   Milky Way): maria fills match `geoContains` point by point on a pentakis dodecahedron.
4. **Worker and store** (`src/worker/projector.ts`, `src/ui/store.ts`,
   `src/ui/useProjectionSync.ts`). `MapKey` gains `'moon'` and a `MoonLoader`; prepared rims are
   cached per minimum diameter. `ProjectResult` reports the crater count. Store fields and
   setters `setCraterMinDiameterKm` and `setMoonGridIntervalDeg`; rerun the projection when they
   change. Rims are ordinary lines, so the live GPU preview needs no markers.
5. **Export and texture.** The new ids join the existing fill and line lists, so `svg.ts` and
   `texture.ts` should need only the layer order entries. Tests: layer colours and order in a Moon
   SVG; Earth and Sky SVG output byte-identical to before (hash check, as in §14 and §15).
6. **UI.** Map tab: a third subject option; in Moon mode the crater slider with its count, and the
   layer table with Moon rows (the Lunar grid row has the interval popover). About dialog: the
   Moon option and credits.
7. **Docs.** Maker guide section "Moon globe" (data, crater size limit, engraving maria on
   translucent acrylic for a lamp, engrave time for a full maria fill). README features, layers
   and credits. Implementation notes here (§16.6) after building.

### 16.6 Resolved in review (2026-11-13)

- Crater limit default **30 km**, log-scale slider 10–300 km.
- **Keep** the Lunar grid layer (off by default).
- Maria default **Outline**.
- **Include** satellite craters.

### 16.7 Implementation notes

- **Step 1 done (2026-11-13).** `buildMoon()` in `scripts/build-data.ts` (run with
  `npm run build:data -- --moon-only`; also part of a full run), `src/data/moon.json`,
  `MoonData` and `MOON_RADIUS_KM` in `src/core/geo/moon.ts`, `loadMoonData()` in
  `src/worker/bundled-data.ts` (not called until step 4), tests in `tests/core/moon.test.ts`.
- **Licences checked.** The LROC mare README states no licence or restriction, only the
  citation (Nelson et al. 2014), and the volume's `AAREADME.TXT` has no terms; it is a NASA PDS
  archive, so it is treated as unrestricted, cited in the credits. The Gazetteer is a USGS work
  (public domain). Both documents are saved in `.cache/moon/` by the build.
- **Pinning.** `LROC_GLOBAL_MARE_180.ZIP` is pinned by SHA-256. The Gazetteer is regenerated
  nightly, so it is checked instead: 2,000–10,000 craters and Copernicus in place (96 km in the
  current data).
- **Maria.** 644 source features (451,704 points), merged with Clipper in planar lon/lat (no
  ring crosses the antimeridian; the build checks. One small mare near 180°, 35–39° S, is
  already split there in the source) so neighbouring maria share no edges and
  Outline mode draws no lines between them. Then Douglas–Peucker at **0.1°** (≈ 3 km, 0.35 mm on
  a 400 mm globe), rings under **50 km²** dropped, merged again to remove any self-crossings, and
  rounded to 0.01°. Result: 532 polygons, 22,130 points, 16.3 % of the surface. Tolerance trials:
  0.03° → 1.25 MB, 0.05° → 790 KB, 0.08° → 524 KB, 0.1° → 429 KB. Merging saved little:
  the boundaries are simply detailed (digitised at 1:200,000). The largest exterior ring
  (Oceanus Procellarum region) is under π sr, so the Milky Way's clipping problem shouldn't
  arise; step 3's containment test will confirm. No separate edge rings are needed: Outline
  strokes the polygon rings.
- **Craters.** The Gazetteer files lettered craters as type `Satellite Feature`, not `Crater`.
  Kept: `Crater, craters` and `Satellite Feature` with a name ending in capital letters, at least
  10 km across (the slider's minimum), positions to 0.01°. 5,626 craters (1,413 named, 4,213
  satellite); **2,301 at 30 km or more** (the default; counted after rounding diameters to
  0.1 km, as the app sees them).
- **Step 2 done (2026-11-13).** `Subject` gains `'moon'`; layers `maria` (fill, C01, on, Outline),
  `craters` (line, C00, on) and `moonGrid` (line, C03, off; label "Lunar grid"), line source
  `mariaEdge` (what Maria strokes), engraving order after the sky's. Settings
  `craterMinDiameterKm` (default 30, `isCraterMinDiameter` 10–300 km) and `moonGridIntervalDeg`
  (default 15, the graticule intervals), parsed additively from project files. Tests in
  `tests/core/moon-settings.test.ts`.
  - Brought forward because the types required them: store fields and setters
    (`setCraterMinDiameterKm`, `setMoonGridIntervalDeg`), the Moon rows in the layer table with
    the Lunar grid's interval popover and Fill / Outline mode labels, and Maria outlines while
    dragging in `LiveLines` (nothing feeds these sources until step 4).
  - Earth and Sky SVG output checked byte-identical to `main` (icosahedron and truncated
    icosahedron; butt, finger and bevel joints; kerf 0.15 mm; all layers and defaults; sky
    both ways round).
- **Step 3 done (2026-11-13).** In `src/core/geo/moon.ts`: `craterRims` (exact small circles,
  one segment per ~10 km, 24–96 segments, closed), `craterCount`, and `mariaOutlines` (the
  rings with the antimeridian seam of the split mare removed by `removeSeams`, so Outline mode
  doesn't engrave it). The pipeline gains the `maria` polygon source and fill, clipped to the
  panel like the Milky Way. Tests in `tests/core/moon-pipeline.test.ts`.
  - **No arc splitting** for rims: the largest crater (536 km) is about 9° in radius, so a rim's
    bounding cap is small enough to cull as it is.
  - **No tiling** for the maria: the fill matches `geoContains` at every sampled point on a cube
    (large faces) and a pentakis dodecahedron, each unrotated and rotated, so Oceanus Procellarum
    clips correctly as one ring. The test filters polygons by lon/lat box first; checking the
    whole region at each sample took minutes.
  - Earth and Sky SVG output still byte-identical to `main`.
- **Step 4 done (2026-11-13).** `Projector` takes a third loader (`MoonLoader`); `MapKey` gains
  `'moon'`; `ProjectRequest.moon: MoonRequest` (`gridIntervalDeg`, `craterMinDiameterKm`);
  `requestSubject` picks the sky, then the Moon, then the Earth. The prepared Moon holds the
  maria fill polygons and `mariaEdge` outlines; crater rims are built per minimum diameter and
  only the last set is cached. `ProjectResult.craterCount`; `lineSegments` takes the crater
  limit for the live preview, and `LiveLines` keeps only the 6 most recent segment sets (each
  crater limit is a new set of several MB). Store `moonRequest()` and `Projection.craterCount`;
  `useProjectionSync` reruns on the Moon settings. Tests in `tests/worker/moon-projector.test.ts`.
  - Step 5 turned out to need nothing: SVG export and the preview texture loop over
    `FILL_LAYERS` and `LINE_LAYERS`, so the Moon layers come through (the projector tests check
    the SVG layer labels).
  - **Speed:** 0.15–0.5 s per full projection (icosahedron, truncated icosahedron, disdyakis
    triacontahedron; craters ≥ 30 or ≥ 10 km; maria outline or fill + outline). SVG output is
    1.2–2.7 MB per shape, under the 4 MB large-output warning.
  - `moon.json` builds as its own 438 KB chunk, loaded only for the Moon. Earth and Sky SVG
    output still byte-identical to `main`.
- **Step 6 done (2026-11-13), not yet tried in a browser.** Map tab: a third subject option,
  "Moon (maria and craters)", with a one-line note on orientation; in Moon mode a **Craters**
  section replaces Map data / Stars, with the smallest-crater slider (log scale, 10–300 km;
  whole km below 100, steps of 5 above), the crater count from the projector, and the crater
  size in mm on the current globe (from the circumsphere diameter, so approximate). The layer
  table note explains why Maria start as outlines. Rotation readout: Lon / Lat / roll as for the
  Earth, captioned "the point on the Moon". About dialog: the Moon in the Map step, and credits
  for NASA LRO / LROC (Nelson et al. 2014) and the IAU / USGS Gazetteer.

### 16.8 Crater shadows (added 2026-11-13)

Plain rim circles looked crude, so each crater also gets a shadow, simulated from its centre and
diameter (the data has no depths).

| Topic | Decision |
|---|---|
| Approach | **Shadow crescents** (vector fills). Real imagery as a raster engrave (an LROC mosaic or hillshade reprojected per panel) was considered and left for later: much more realistic, but a new raster path through worker, preview and export, several MB of data, and a long grayscale engrave. |
| Light | **Fixed from the upper left**: local north-west at every crater, as on shaded-relief maps, so every crater is shaded the same way round across the globe. |
| Look | **Rim + inner shadow.** The rim line stays; the shadow is the crescent of floor nearest the light, where the rim shades the inner wall. |
| Layer | **Crater shadows**, fill layer (Fill / Outline / both), LightBurn **07 (`#FF00FF`)** so it can be engraved at its own power, on by default. Follows the crater-size slider. |

- **Geometry** (`craterShadows` in `src/core/geo/moon.ts`): the rim's disc minus the same disc
  moved away from the light by a fraction of its radius, built in the crater's gnomonic tangent
  plane (where the rim is an exact circle) and mapped back to the sphere, wound the d3 way. The
  fraction (`shadowFraction`) is 40 % up to 50 km, falling with log diameter to 10 % at 500 km,
  so flat-floored basins get a thin crescent rather than a bowl's.
- **Per-crater variation** (added 2026-11-13, at the user's request, for realism): each crater
  gets its own `craterVariation`, seeded from its rounded lon, lat and diameter, so it is stable
  across exports, crater limits and orientations. Depth × 0.7–1.3 (capped at 60 % of the
  radius); light azimuth ± 12°; and a ragged inner edge, three low harmonics (2, 3, 5 waves)
  with random phases moving the edge along the light by up to ± 35 % of the shadow's depth,
  fading to zero at the horns. The plain crescent is exactly `s` deep along the light at every
  height, so offsets kept within 80 % of the room on either side can't cross the rim or the
  ring itself; the outer edge stays exactly on the rim. No setting: cost and SVG size are
  unchanged.
- **Out-of-round rims** (added 2026-11-13, user request): each rim's radius gets four seeded
  harmonics: oval (k = 2, ≤ 6 %), and lumpy or polygonal (k = 3, 4, 5: ≤ 3, 1.5, 1 %). They're
  halved at 10 km and in full from 100 km, since small craters are the roundest. Σ a·(k² − 1) < 1
  keeps every rim convex; the worst rim in the data is 8.7 % from its nominal radius. Rims and
  shadows are built from the same points in the crater's (north, west) gnomonic plane, so they
  line up exactly. The crescent generalises to any convex rim: at each height across the light
  the shadow spans max(far wall, near wall − s) … near wall.
- **Central peak shadows** (added 2026-11-13, user request: "only on some large craters"): 55 %
  of craters of 45–180 km (683 of 1,249 in the data; larger basins have peak rings or flooded
  floors), 35 % of those as a pair. Each peak is 7–13 % of the crater's radius, within 8 % of
  the centre; its shadow is an egg from just in front of the crest, stretching 2–3.5 peak radii
  (× the crater's depth factor) away from the light, kept inside 70 % of the radius. They're
  extra polygons on the Crater shadows layer. `craterShadowSets` groups shadows by crater for
  the tests. Cost: about +5 % time and +150 KB SVG at 30 km.
- The projector builds rims, crescents and the crescents' outlines (`craterShadowEdge`, for
  Outline mode and the live preview) together per crater limit. The pipeline fills crescents
  like the maria; overlapping crescents merge in the per-panel union.
- Tests in `tests/core/crater-shadows.test.ts`: one crescent per crater, inside its rim, of an
  area within the variation's bounds, north-west give or take 25°, a simple ring for 300
  varied craters, variation deterministic and spread across its range, rims within their
  amplitude and not round, crescents inside their own rim, peaks on 45–65 % of 45–180 km
  craters and none outside that range, peak shadows inside the rim and south-east of the peak, at the poles and across the antimeridian;
  projector tests for the layer, its colour and switching it off.
- **Cost:** at the default 30 km a full projection takes 0.4–0.65 s and the SVGs are 1.9–2.4 MB
  per shape (from 0.15–0.35 s and 1.2–1.6 MB without shadows). At 10 km it is 0.8–1.2 s and
  3.6–4.4 MB, so the large-output warning (4 MB) can appear. Earth and Sky output unchanged.
- **To judge on a real engrave:** shadow depth (40 % may be heavy on small craters), and the
  shadow power relative to maria fills.
