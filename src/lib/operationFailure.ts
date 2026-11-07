/** Identify authorization failures without storing or displaying the server message. */
export function isAuthorizationFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const result = error as { code?: unknown; status?: unknown; statusCode?: unknown; message?: unknown }
  const status = String(result.status ?? result.statusCode ?? '')
  const message = typeof result.message === 'string' ? result.message.toLowerCase() : ''
  return status === '401' || status === '403' || result.code === '42501'
    || /row-level security|permission denied|access denied|access required|not authorized|unauthorized|forbidden/.test(message)
}
