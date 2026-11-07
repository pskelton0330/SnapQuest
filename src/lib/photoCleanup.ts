export type PhotoCleanupStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function key(huntId: string, teamId: string) {
  return `snapquest:photo-cleanup:${huntId}:${teamId}`
}

export function pendingPhotoCleanup(storage: PhotoCleanupStorage, huntId: string, teamId: string): string[] {
  try {
    const raw = storage.getItem(key(huntId, teamId))
    const paths = raw ? JSON.parse(raw) : []
    return Array.isArray(paths) ? paths.filter((path): path is string => typeof path === 'string' && path.length > 0) : []
  } catch { return [] }
}

export function queuePhotoCleanup(storage: PhotoCleanupStorage, huntId: string, teamId: string, path: string) {
  const paths = pendingPhotoCleanup(storage, huntId, teamId)
  if (!paths.includes(path)) {
    // Keep every failed deletion. Truncating this list silently orphans older objects
    // when a team replaces many photos while offline.
    try { storage.setItem(key(huntId, teamId), JSON.stringify([...paths, path])) } catch { /* Best-effort local retry queue. */ }
  }
}

export function completePhotoCleanup(storage: PhotoCleanupStorage, huntId: string, teamId: string, path: string) {
  const remaining = pendingPhotoCleanup(storage, huntId, teamId).filter(item => item !== path)
  try {
    if (remaining.length) storage.setItem(key(huntId, teamId), JSON.stringify(remaining))
    else storage.removeItem(key(huntId, teamId))
  } catch { /* Best-effort local retry queue. */ }
}

export async function removePhotoOrQueueCleanup(
  storage: PhotoCleanupStorage | null,
  huntId: string,
  teamId: string,
  path: string,
  remove: () => Promise<{ error: unknown | null }>,
): Promise<boolean> {
  try {
    const { error } = await remove()
    if (!error) {
      if (storage) completePhotoCleanup(storage, huntId, teamId, path)
      return true
    }
  } catch { /* A disconnected client needs the same retry path as a returned Storage error. */ }
  if (storage) queuePhotoCleanup(storage, huntId, teamId, path)
  return false
}
