/** Public world entities, joined across panes by their server-assigned IDs. */
export type EntityKind = 'vessel' | 'route' | 'dock' | 'job'

export interface EntityRef {
  kind: EntityKind
  id: string
}

export function entityKey(entity: EntityRef): string {
  return `${entity.kind}:${entity.id}`
}

export function sameEntity(a: EntityRef | null | undefined, b: EntityRef | null | undefined): boolean {
  return !!a && !!b && a.kind === b.kind && a.id === b.id
}

export function hasEntity(list: readonly EntityRef[], entity: EntityRef | null): boolean {
  return entity !== null && list.some((item) => sameEntity(item, entity))
}
