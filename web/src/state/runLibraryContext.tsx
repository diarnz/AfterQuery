import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react'
import type { LibrarySnapshot, RunLibrary } from './runLibrary'
import type { RunRecord } from './runRecord'

const RunLibraryContext = createContext<RunLibrary | null>(null)

export function RunLibraryProvider({ library, children }: { library: RunLibrary; children: ReactNode }) {
  return <RunLibraryContext.Provider value={library}>{children}</RunLibraryContext.Provider>
}

export function useRunLibrary(): RunLibrary {
  const library = useContext(RunLibraryContext)
  if (!library) throw new Error('useRunLibrary must be used inside RunLibraryProvider.')
  return library
}

export function useLibrarySnapshot(): LibrarySnapshot {
  const library = useRunLibrary()
  return useSyncExternalStore(library.subscribe, library.getSnapshot, library.getSnapshot)
}

export function useRun(id: string | undefined): { record: RunRecord | undefined; live: boolean } {
  const snapshot = useLibrarySnapshot()
  const record = id ? snapshot.records.find((item) => item.id === id) : undefined
  return { record, live: id ? snapshot.live.has(id) : false }
}
