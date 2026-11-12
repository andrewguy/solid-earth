/** `<shape>_face-NN.svg`, zero-padded face index (plan §3). */
export const faceFileName = (shape: string, index: number) =>
  `${shape}_face-${String(index).padStart(2, '0')}.svg`

export const zipFileName = (shape: string) => `${shape}_faces.zip`

/** `<shape>_sheet-NN.svg`, numbered from 01 like the Sheets tab (plan §13.1 Output). */
export const sheetFileName = (shape: string, index: number) =>
  `${shape}_sheet-${String(index + 1).padStart(2, '0')}.svg`

/** ZIP of every face SVG, any sheet SVGs, and `project.json` (plan §6.5, §13.1). */
export async function buildFacesZip(
  shape: string,
  svgs: readonly string[],
  projectJson: string,
  sheetSvgs: readonly string[] = [],
): Promise<Uint8Array<ArrayBuffer>> {
  // Loaded on demand: only needed when the user exports.
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  svgs.forEach((svg, i) => zip.file(faceFileName(shape, i), svg))
  sheetSvgs.forEach((svg, i) => zip.file(sheetFileName(shape, i), svg))
  zip.file('project.json', projectJson)
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
  // JSZip allocates a plain ArrayBuffer; its typings just predate Uint8Array generics.
  return bytes as Uint8Array<ArrayBuffer>
}
