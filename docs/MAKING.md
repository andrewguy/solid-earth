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
- **Thickness** doesn't change the cut files (see joints below), but it is used for the inner
  gap figures in _Panel geometry_.

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

Panels are cut square at the true face size, so their **outer faces meet exactly** at each edge
and the map lines up. On the inside, a V-shaped gap opens between neighbouring panels. _Panel
geometry_ lists the angle and width of that gap for your thickness (for 3 mm panels on an
icosahedron, about 41.8° and 2.1 mm).

Because the panels only touch along a line, the strength comes from glue in the V:

1. **Number the backs.** Before separating parts from the sheet, pencil each panel's number
   (from the file name) on the back.
2. **Plan neighbours.** The enlarged-face dialog lists which face joins each edge.
3. **Tape-hinge method.** Lay neighbouring panels face down, edges touching, and run masking tape
   along the joint on the _outer_ faces. Build strips or flowers of panels this way, then fold them
   up; the tape holds the outer edges together while the glue sets.
4. **Fillet the V.** Run epoxy or thick CA glue along the inside of each joint. For plywood, PVA
   with a bead along the V works too, given time to cure.
5. Close the last few panels carefully; reaching inside gets harder as the globe closes. Leaving
   one panel loose until the end makes it easier.

## 9. Troubleshooting

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
