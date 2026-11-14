import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { sameEntity, type EntityRef } from '../lib/entities'

interface SelectionValue {
  /** Transient highlight from hovering or focusing an entity, or a trace row that mentions several. */
  hovered: readonly EntityRef[]
  /** Sticky filter chosen by click; the trace shows only rows that mention it. */
  pinned: EntityRef | null
  setHovered(entities: readonly EntityRef[]): void
  togglePinned(entity: EntityRef): void
  clearPinned(): void
}

const SelectionContext = createContext<SelectionValue | null>(null)
const NONE: readonly EntityRef[] = []

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [hovered, setHoveredState] = useState<readonly EntityRef[]>(NONE)
  const [pinned, setPinned] = useState<EntityRef | null>(null)
  const value = useMemo<SelectionValue>(
    () => ({
      hovered,
      pinned,
      setHovered: (entities) => setHoveredState(entities.length ? entities : NONE),
      togglePinned: (entity) => setPinned((current) => (sameEntity(current, entity) ? null : entity)),
      clearPinned: () => setPinned(null),
    }),
    [hovered, pinned],
  )
  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>
}

export function useSelection(): SelectionValue {
  const value = useContext(SelectionContext)
  if (!value) throw new Error('useSelection must be used inside SelectionProvider.')
  return value
}
