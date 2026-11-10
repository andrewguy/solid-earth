# Polyhedral Map Projector: Project Plan

> Status: **scope agreed (v1, 2026-11-10)**. Ready to start milestone 1.

---

## 1. Overview

A client-side web app that takes vector world-map data (countries, coastlines, rivers, lakes, graticule) and projects it onto the faces of a chosen polyhedron (icosahedron, cube, truncated icosahedron/soccer ball, or a custom convex solid). It exports **one SVG per face** in real-world millimetres, with separate laser layers for cutting and engraving. The cut panels assemble into a physical 3D globe.

**Audience:** the author, plus other makers it is shared with. It is a hosted static site with decent UX and maker-facing docs. It is not a polished commercial product.

**Approach in one line:** the sphere is projected radially from the solid's centre onto each face plane (gnomonic projection per face). This maps great circles to straight lines, so features continue exactly across shared edges.

---

## 2. Requirements

### 2.1 Release 1 (panel mode)
- Load Natural Earth vector data. 110m and 50m are bundled; 10m loads on demand.
- Polyhedron presets: tetrahedron, cube, octahedron, dodecahedron, icosahedron, truncated icosahedron. The icosahedron is the primary dev/test target.
- **Custom polyhedra, early:** import from OBJ and from JSON `{vertices, faces}`. Convex only.
- Project the map onto each face, clipped to the face polygon, with exact edge continuity across neighbouring faces.
- 2D preview of each face, and a 3D preview of the assembled solid with the map applied.
- Rotate the globe under the polyhedron by dragging in the 3D preview.
- Layers with per-layer toggles and stroke/fill settings: coastlines, country borders, rivers, lakes, land fill, ocean fill, graticule.
- Laser output separated by operation, with LightBurn colour conventions (configurable): **cut** (face outline), **engrave** (lines and fills), **score** (graticule by default).
- Panel mode: material thickness setting, butt joints with outer faces meeting, optional kerf compensation, dihedral and V-gap info.
- Export an SVG per face, and a ZIP of all faces plus the project file.
- Save the project in the browser automatically, and import/export a project JSON file.

### 2.2 Later releases (backlog, rough priority order)
1. Paper/card mode: unfolded net export on a single sheet with fold/score lines and glue tabs.
2. Assembly aids: edge/face ID labels, assembly guide sheet.
3. Bevel joints.
4. Nested sheet export for a given laser bed size.
5. Internal frame/connector generation.
6. Finger joints.
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
| Butt joint geometry | **Outer faces meet at the true edge.** Square-cut panels are cut at the true face size, so the outer surface matches the polyhedron exactly and the map lines up. A V-gap opens on the inside: gap angle = 180° − dihedral (about 41.8° on an icosahedron). Panels touch only along a line, so the docs recommend a glue/epoxy fillet in the V, or an internal frame once available. |
| Kerf | Optional outward offset of the cut path by kerf/2. **Off by default**, so users can rely on LightBurn's own offset. Default value 0.15 mm. Engraving is never offset. |
| Engraving style | Fully configurable per layer: stroke and/or fill, colour, LightBurn layer. |
| Map layers | Coastlines, country borders, rivers, lakes, land, optional ocean (face minus land), graticule. No text labels in R1. |
| Data resolution | User-selectable. 110m and 50m bundled; 10m loaded on demand from the site's own static assets, with a simplification control. |
| Model sizing | Edge length in mm, with the resulting circumsphere diameter shown alongside. For custom shapes with unequal edges, the **longest edge** = N mm. One global scale applies to all faces. |
| Default LightBurn colours | Cut = layer 02 `#FF0000`. Engrave lines (coast/borders/rivers) = 00 `#000000`. Engrave fills (land/lakes/ocean) = 01 `#0000FF`. Score/graticule = 03 `#00E000`. All editable. |
| Face orientation in SVG | **North-up:** each panel is rotated so the local north direction at the face centre points up. If a pole is on or very near the face centre, the longest edge goes on the baseline instead. |
| File naming | `<shape>_face-NN.svg` (zero-padded face index from the polyhedron definition; the same number appears in the 2D and 3D previews). ZIP: `<shape>_faces.zip`, which includes `project.json`. |
| Globe rotation | Drag the globe in the 3D preview (arcball). Stored as a quaternion and shown read-only as lon/lat/roll, with a reset button. |
| Persistence | localStorage autosave (debounced), plus import/export of a versioned project JSON. Custom polyhedra are embedded in the project file. |
| Performance | Projection runs in a **web worker from R1**. 110m preview while dragging, full resolution once the drag ends. |
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
- **Gnomonic distortion** grows toward face corners. It is fine on an icosahedron or soccer ball, noticeable on a cube, and severe on a tetrahedron (about 9× areal scale at the corners compared with the centre). The UI shows a per-shape distortion warning.
- **Clipped polygons** must stay closed and correctly wound for fill engraving.
- **Float noise:** keep SVG coordinates in mm, rounded to 0.01 mm (well under laser precision), then remove duplicate points.
- **Material thickness:** flat panels don't meet at the mathematical edges unless the joint accounts for thickness. Engraving is always projected onto the **outer** surface polygon. With butt joints where the outer faces meet (R1), the outer surface is the true face.
- **Kerf:** the laser removes about 0.1–0.2 mm. Offset the cut outward by kerf/2 if enabled; never offset engraving.
- **LightBurn assigns layers by exact stroke colour**, not by SVG groups. Colours must be exact palette values. Inkscape uses `inkscape:groupmode="layer"` groups, and both are emitted.
- **Data size:** 10m countries and rivers are tens of MB, so simplification is needed.
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
- 10m is loaded on demand from the site's own static assets, with a simplification slider.
- Graticule: generated with `d3.geoGraticule`, configurable interval (default 15°), densified.

### 6.3 Panel geometry
- Cut outline = true face polygon (butt joint with outer faces meeting).
- Optional kerf offset: Clipper2, mitre joins.
- The info panel shows, per edge: dihedral angle and V-gap angle. It also shows material thickness, edge length and circumsphere diameter.

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
- **Warnings:** distortion level, polyhedron validation errors, large output at 10m.

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
| Planar polygons | **clipper2-js** | Robust boolean operations plus offsetting (kerf, and later tabs and fingers). Preferred over `polygon-clipping`, which is largely unmaintained and less robust. |
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
8. **Panel mode:** thickness, kerf offset, dihedral and V-gap info, north-up orientation, 50m/10m resolution switching.
9. **Deployment:**
   - public GitHub repo setup
   - GitHub Actions workflow: typecheck, lint, test, build, deploy to GitHub Pages on `main`, gated on tests
   - Vite `base` path for Pages, and 10m data served as static assets
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
  - 3D preview runs at ≥ 30 fps while dragging (110m data).
  - A full 50m re-projection of all 32 truncated icosahedron faces takes < 2 s on a typical laptop.
- **Local:** `npm run dev`, `npm test`, `npm run typecheck`, `npm run lint` and `npm run build` all succeed locally from a fresh clone.
- **CI (milestone 9):** the same checks pass in GitHub Actions on `main`, and the site deploys to GitHub Pages.
- **UI:** all standard controls are shadcn/ui components styled with Tailwind; there are no hand-rolled buttons, inputs etc.

---

## 10. Open questions / risks

- **Butt joint strength:** panels with outer faces meeting touch only along a line. Is a glue fillet sufficient at real sizes, or should the internal frame move earlier?
- **North-up near poles:** the longest-edge fallback may look inconsistent. Revisit once there is real output.
- **10m data:** check download size and performance. Cap at 50m if it's unworkable.
- **LightBurn import quirks:** SVG mm units, group handling and fill import. Verify in milestone 3.
