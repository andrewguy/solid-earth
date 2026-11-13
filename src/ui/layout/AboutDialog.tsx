import { BookOpen, CircleHelp, CodeXml } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from '@/ui/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/ui/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/components/ui/tooltip'

const REPO_URL = 'https://github.com/andrewguy/solid-earth'
const GUIDE_URL = `${REPO_URL}/blob/main/docs/MAKING.md`

const LAYERS: readonly { colour: string; name: string; use: string }[] = [
  { colour: '#FF0000', name: 'Cut', use: 'panel outlines' },
  { colour: '#000000', name: 'Engraved lines', use: 'coastlines, borders, rivers' },
  { colour: '#0000FF', name: 'Engraved fills', use: 'land, lakes, ocean' },
  { colour: '#00E000', name: 'Score', use: 'graticule' },
  { colour: '#D0D000', name: 'Sanding guide', use: 'bevel joints only' },
  { colour: '#00E0E0', name: 'Stars', use: 'night sky, fill or rings' },
  { colour: '#FF8000', name: 'Star holes', use: 'night sky lamp; cut before the outline' },
]

function HelpSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>
      {children}
    </section>
  )
}

/** What the app is and how to use it, opened from the icon beside the app name. */
export function AboutDialog() {
  return (
    <Dialog>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground"
              aria-label="About and help"
            >
              <CircleHelp />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent>About and help</TooltipContent>
      </Tooltip>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Solid Earth</DialogTitle>
          <DialogDescription>
            Turn a world map into laser-cut panels that assemble into a polyhedral globe.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 leading-relaxed">
          <p>
            Pick a solid, spin the globe underneath it, and export one SVG per panel at real size in
            millimetres, ready for LightBurn. Each panel uses a gnomonic projection from the centre
            of the solid, which keeps great circles straight, so coastlines, borders and the grid
            run on exactly from one panel to the next once the globe is assembled.
          </p>

          <HelpSection title="Getting started">
            <ol className="list-decimal space-y-1.5 pl-5">
              <li>
                <strong>Shape:</strong> choose a solid (or import a convex OBJ / JSON) and set the
                edge length. Shapes with more faces distort the map less.
              </li>
              <li>
                <strong>Map:</strong> choose the Earth, the night sky or the Moon, then which layers
                to draw: coastlines, borders, fills and the graticule; stars, constellations and the
                Milky Way; or maria and craters. Each layer has its own LightBurn colour.
              </li>
              <li>
                <strong>Panels:</strong> enter your material thickness, optional kerf compensation,
                and butt, finger or sanded bevel joints.
              </li>
              <li>
                <strong>Sheets:</strong> set your sheet or laser bed size, then press{' '}
                <em>Nest panels</em> on the Sheets tab in the right panel to lay the panels out.
              </li>
              <li>
                <strong>Export:</strong> click a thumbnail for a single panel, or use <em>ZIP</em>{' '}
                for every panel, the sheets and the project file.
              </li>
            </ol>
          </HelpSection>

          <HelpSection title="3D view">
            <ul className="list-disc space-y-1 pl-5">
              <li>
                Drag to turn the map under the solid; try to keep places you care about away from
                edges.
              </li>
              <li>Right-drag (or Alt-drag) orbits the camera; the wheel zooms.</li>
              <li>Double-click a face to see that panel at full size.</li>
            </ul>
          </HelpSection>

          <HelpSection title="LightBurn layers">
            <ul className="space-y-1">
              {LAYERS.map((l) => (
                <li key={l.name} className="flex items-center gap-2">
                  <span
                    className="size-3 shrink-0 rounded-sm ring-1 ring-foreground/20"
                    style={{ backgroundColor: l.colour }}
                  />
                  <span className="font-medium">{l.name}</span>
                  <span className="text-muted-foreground">{l.use}</span>
                </li>
              ))}
            </ul>
            <p className="text-muted-foreground">
              LightBurn assigns layers by exact colour. Test power and speed on scrap first, and run
              the cut layer last.
            </p>
          </HelpSection>

          <HelpSection title="Your work">
            <p className="text-muted-foreground">
              Everything runs in your browser; nothing is uploaded. Projects are autosaved here, and
              the toolbar saves or opens project files to keep a copy or move between computers.
            </p>
          </HelpSection>

          <p className="text-xs text-muted-foreground">
            Map data from Natural Earth (public domain). Sky data from d3-celestial (BSD). Moon data
            from NASA LRO / LROC (maria, Nelson et al. 2014) and the IAU / USGS Gazetteer of
            Planetary Nomenclature (craters). Code under the MIT licence.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" asChild>
            <a href={REPO_URL} target="_blank" rel="noreferrer">
              <CodeXml /> Source
            </a>
          </Button>
          <Button asChild>
            <a href={GUIDE_URL} target="_blank" rel="noreferrer">
              <BookOpen /> Maker guide
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
