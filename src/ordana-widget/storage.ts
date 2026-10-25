// Embedded frames can have storage blocked. Every read/write goes through here and falls back
// to memory, so a blocked read never crashes the widget (the visitor just isn't remembered).

type Store = { get(key: string): string | null; set(key: string, value: string): void; remove(key: string): void }

function safe(pick: () => Storage): Store {
  const memory = new Map<string, string>()
  const real = (): Storage | null => {
    try {
      return pick()
    } catch {
      return null
    }
  }
  return {
    get(key) {
      try {
        const v = real()?.getItem(key)
        if (v != null) return v
      } catch {
        /* blocked */
      }
      return memory.get(key) ?? null
    },
    set(key, value) {
      memory.set(key, value)
      try {
        real()?.setItem(key, value)
      } catch {
        /* blocked */
      }
    },
    remove(key) {
      memory.delete(key)
      try {
        real()?.removeItem(key)
      } catch {
        /* blocked */
      }
    },
  }
}

export const local = safe(() => window.localStorage)
export const session = safe(() => window.sessionStorage)
