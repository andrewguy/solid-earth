import { parsePolyhedronJson } from './json'
import { parseObj } from './obj'
import { PolyhedronError, preprocess } from './preprocess'
import type { PolyhedronDef } from './types'

/** File-name-safe slug, used for the shape name and therefore export file names. */
export function slugify(s: string): string {
  const slug = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'custom'
}

/**
 * Import a custom polyhedron from an `.obj` or `.json` file's text: parse, then normalise and
 * validate (plan §4.1). Throws `PolyhedronError` with a user-readable message.
 */
export function importPolyhedron(fileName: string, text: string): PolyhedronDef {
  const ext = /\.([^.]+)$/.exec(fileName)?.[1]?.toLowerCase()
  const base = slugify(fileName.replace(/\.[^.]+$/, ''))
  let raw: PolyhedronDef
  if (ext === 'obj') raw = parseObj(text, base)
  else if (ext === 'json') raw = parsePolyhedronJson(text, base)
  else throw new PolyhedronError(`unsupported file type ".${ext ?? ''}" (use .obj or .json)`)
  return preprocess({ ...raw, name: slugify(raw.name) })
}
