import type { ProjectSettings } from '../settings'

export const PROJECT_SCHEMA_VERSION = 1

/** Versioned project file (plan §7.3). Import and autosave arrive in milestone 10. */
export interface ProjectFile extends ProjectSettings {
  readonly schemaVersion: typeof PROJECT_SCHEMA_VERSION
  readonly app: 'polyhedral-map-projector'
}

export function toProjectFile(settings: ProjectSettings): ProjectFile {
  return { schemaVersion: PROJECT_SCHEMA_VERSION, app: 'polyhedral-map-projector', ...settings }
}

export function serializeProject(settings: ProjectSettings): string {
  return `${JSON.stringify(toProjectFile(settings), null, 2)}\n`
}
