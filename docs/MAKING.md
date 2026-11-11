# Maker guide

From a world map to an assembled polyhedral globe. This guide assumes a CO₂ or diode laser
driven by LightBurn and 3 mm plywood or acrylic, but the files work with any laser software that
reads SVG.

## 1. Choose a shape

More faces means less distortion and a rounder globe, but more panels to cut and glue.

| Shape                                                   | Panels                                      | Distortion at panel corners (area) | Notes                                     |
| ------------------------------------------------------- | ------------------------------------------- | ---------------------------------- | ----------------------------------------- |
| Rhombicosidodecahedron                                  | 62 (20 triangles, 30 squares, 12 pentagons) | about 1.3×                         | Very round; three panel shapes            |
| Snub dodecahedron                                       | 92 (80 triangles, 12 pentagons)             | about 1.3×                         | Roundest; lots of small triangles; chiral |
| Truncated icosahedron                                   | 32 (12 pentagons, 20 hexagons)              | about 1.3×                         | The "soccer ball"; a great all-rounder    |
| Truncated icosidodecahedron                             | 62 (30 squares, 20 hexagons, 12 decagons)   | about 1.35×                        | Large decagons for big regions            |
| Icosidodecahedron                                       | 32 (20 triangles, 12 pentagons)             | about 1.6×                         | Few panel types, nicely round             |
| Rhombicuboctahedron, snub cube, truncated cuboctahedron | 26 / 38 / 26                                | 1.6–1.8×                           | Cube-symmetric alternatives               |
| Icosahedron, dodecahedron                               | 20 / 12                                     | about 2×                           | Classic; simplest to assemble             |
| Truncated octahedron                                    | 14 (6 squares, 8 hexagons)                  | about 2.2×                         |                                           |
| Cuboctahedron, truncated cube                           | 14 / 14                                     | about 3×                           | Noticeable stretching                     |
| Cube, octahedron                                        | 6 / 8                                       | about 5×                           | Noticeably stretched corners              |
| Truncated tetrahedron, tetrahedron                      | 8 / 4                                       | 7× / 27×                           | Mostly curiosities                        |

All 5 Platonic and 13 Archimedean solids are built in. Archimedean solids mix two or three panel
shapes; every edge is the same length, so the edge length you enter applies to all panels. The
two snub solids are chiral (they have a left- and right-handed form); the app builds one
handedness.

**Catalan solids** (the duals of the Archimedean solids) have **every panel identical**: one
outline, one dihedral angle at every joint. That makes them easy to nest on a sheet and very
consistent to assemble, at the cost of two or three different edge lengths per panel (the
edge length you enter is the longest one). Good picks:

| Shape                      | Panels                | Distortion (area) |
| -------------------------- | --------------------- | ----------------- |
| Disdyakis triacontahedron  | 120 triangles         | about 1.35×       |
| Deltoidal hexecontahedron  | 60 kites              | about 1.3×        |
| Pentakis dodecahedron      | 60 triangles          | about 1.3×        |
| Pentagonal hexecontahedron | 60 pentagons (chiral) | about 1.3×        |
| Rhombic triacontahedron    | 30 rhombi             | about 1.6×        |
| Rhombic dodecahedron       | 12 rhombi             | about 2.8×        |

Each Catalan solid has the same distortion as its Archimedean partner.

The app shows a warning for shapes with noticeable or severe distortion. Distortion here only
means features look larger toward the panel corners. Lines still meet exactly across edges on
every shape.

**Your own shape:** use _Import OBJ / JSON_. The shape must be **convex** (no dents or holes);
triangulated exports are fine, because coplanar triangles are merged back into flat panels.
Units don't matter: everything is scaled so the longest edge equals the edge length you enter.
If a file is rejected, the message says why (for example, which vertex makes it non-convex).

## 2. Size and material

- **Edge length** is the length of the longest panel edge in mm. The resulting globe diameter
  (circumsphere) is shown underneath.
- Check that the largest panel fits your laser bed. Hexagons on a truncated icosahedron are
  2 × edge wide.
- **Thickness** must match your material: each panel edge is pulled in so square-cut panels
  meet at their inner corners (see assembly below). Measure your sheet with calipers; nominal
  "3 mm" ply is often 2.7–3.2 mm.

## 3. Place the map

Drag the globe in the 3D view to rotate the map under the solid. Right-drag (or Alt-drag) orbits
the camera; the wheel zooms.

Tips:

- Edges cut through the map, so turn the globe until the places you care about sit near panel
  centres rather than across edges or corners.
- The _Globe rotation_ readout shows which point is at the top of the solid. _Reset rotation_
  puts the north pole on top again.
- Toggle _Face numbers_ to see which panel is which. The numbers match the exported file names
  and the thumbnails.

## 4. Layers

Each layer has a switch, a LightBurn colour, and (for land, lakes and ocean) a mode:

- **Fill:** a filled area for fill engraving.
- **Shore line:** just the coastline or lake edge, as a line.
- **Fill + line:** both.

Fill layers never draw lines along the panel edges: "shore line" always follows the real
coastline. The graticule (latitude/longitude grid) defaults to 15° and can be set to 5–30° in
its colour menu.

_Map data_ sets the level of detail. 1:50m suits most panels; 1:110m is coarser and lighter. The
app warns when the output gets large enough to slow LightBurn down.

## 5. LightBurn set-up

Import the SVGs (_File → Import_). The files declare their size in mm, so they arrive at true
scale. Measure one panel edge to confirm before cutting.

LightBurn assigns layers **by exact colour**, so with the default colours you get:

| Layer                | Colour | Suggested LightBurn mode                 |
| -------------------- | ------ | ---------------------------------------- |
| 02 Cut               | red    | Line, full cut                           |
| 00 Engraved lines    | black  | Line, low power (a light vector engrave) |
| 01 Engraved fills    | blue   | Fill                                     |
| 03 Score (graticule) | green  | Line, very low power                     |

Power and speed depend entirely on your machine and material, so run a test on scrap first. Set
the cut layer to run last so panels don't shift while the engraving runs.

## 6. Kerf

The laser removes a thin strip of material (typically 0.1–0.2 mm). Panels cut on the line come out
very slightly small, which opens tiny gaps at the joints.

- **Default (off):** set a kerf offset in LightBurn's cut settings for the cut layer.
- **Or turn on _Kerf compensation_** in the app and enter your kerf: the cut path is offset
  outward by half the kerf in the SVG itself. Engraving is never offset.

Use one or the other, not both.

## 7. Export

- Click a thumbnail (or double-click a face in 3D) to see a panel at full size and download its
  SVG alone.
- **ZIP** downloads every panel plus `project.json`, which reopens the exact project later via
  _Open project_.
- Files are named `<shape>_face-NN.svg`. Panels are rotated **north-up**: local north at the
  panel centre points up the page. A panel with a pole near its centre has its longest edge at the
  bottom instead.

Your work is autosaved in the browser. Use _Save project_ to keep a copy or move it to another
computer.

## 8. Assembly

A laser cuts square edges, and square-cut panels can't meet at their outer faces on a convex
solid (their inner corners would collide). So each panel edge is **pulled in** slightly, by an
amount that depends on your thickness and the angle at that joint, so that neighbouring panels
meet along their **inner** corners. That leaves a V-shaped groove on the **outside** of every
joint. _Panel geometry_ lists the inset and the groove width for your thickness; for 3 mm panels
on an icosahedron the inset is about 1.15 mm and the groove is about 41.8° and 2.1 mm wide.

The map is projected as if the panels met exactly, then trimmed to each panel, so lines still
line up across the groove; only the strip inside the groove has no engraving. Leave the grooves as
crisp seams, or fill them with wood filler or tinted epoxy and sand flush.

Because the panels only touch along a line, the strength comes from glue on the inside corner:

1. **Number the backs.** Before separating parts from the sheet, pencil each panel's number
   (from the file name) on the back.
2. **Plan neighbours.** The enlarged-face dialog lists which face joins each edge, and each
   edge's true and cut length.
3. **Tape and fold.** Bring neighbouring panels together so their inner (back) edges touch, and
   run masking tape across the groove on the _outer_ faces to hold them. Build strips or flowers of
   panels this way; the tape holds the joints while the glue sets.
4. **Fillet the inside corner.** Run epoxy or thick CA glue along the inside of each joint, where
   the back faces meet. For plywood, PVA with a bead along the corner works too, given time to
   cure.
5. Close the last few panels carefully; reaching inside gets harder as the globe closes. Leaving
   one panel loose until the end makes it easier.

## 9. Finger joints

Set _Joints_ to **Finger joints** under _Panel geometry_ for interlocking fingers on every edge.
They line panels up as you assemble and give the glue far more area than a butt joint.

- **Finger width** is the same for every finger. Each edge gets an even number of fingers and
  slots, with plain stretches at the corners so fingers never collide where panels meet. An edge
  too short for two fingers stays a butt joint; the enlarged-face dialog shows the count per
  edge.
- **Clearance per side** narrows each finger and widens each slot (default 0.1 mm, a slip fit
  for gluing). A negative value gives a press fit, which is very sensitive to kerf and to your
  sheet's real thickness, so test on scrap first. Kerf compensation (if on) is applied on top.
- **Finger tips:**
  - **Fill joint** (default): fingers reach right through the neighbouring panel and stick out
    slightly past its surface. Sand them flush for a closed outer surface. The map is never
    engraved on the part that sticks out, so sanding loses nothing.
  - **Flush:** nothing sticks out, and small wedge-shaped gaps open at the surface beside each
    finger.

A laser cuts square edges, so fingers only mate perfectly where panels meet at 90° (a cube).
At other angles each joint has a small triangular void on the inside, which is a handy glue
pocket. On very sharp joints (under 90°, like a tetrahedron) a thin gap stays open on the
outside even with _Fill joint_.

Thickness matters even more than with butt joints: measure your sheet and enter the real value.

## 10. Troubleshooting

- **Panels the wrong size in LightBurn:** check that the import didn't apply a DPI scale. The SVGs
  are in mm (`width="…mm"`).
- **Wrong layers in LightBurn:** layer colours must be exact palette values. Keep the defaults,
  or pick from the app's palette, which only offers LightBurn colours.
- **An imported shape is rejected:** it must be a closed, convex solid. The message names the
  vertex or face at fault.
- **Something looks off after an update:** _New project_ resets everything to defaults.

## About the map

Map data is from [Natural Earth](https://www.naturalearthdata.com/) (public domain). Borders
follow Natural Earth's default point of view.
