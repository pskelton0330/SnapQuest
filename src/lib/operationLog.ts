import { supabase } from './supabase'
import { isAuthorizationFailure } from './operationFailure'

const lastReportAt = new Map<string, number>()
/** Client-side reports are explicitly labeled and contain no media paths or user content. */
export type OperationApp = 'participant_web' | 'organizer_web'
type OperationOutcome = 'success' | 'failure' | 'notice'
type Operation = { id: string; stage: string; outcome: OperationOutcome; recoveryMs?: number }

async function writeOperation(huntId: string, app: OperationApp, operation: Operation): Promise<boolean> {
  if (!supabase) return false
  try {
    const { error } = await supabase.rpc('record_audit_event', {
      p_event_type: 'client_operation',
      p_hunt_id: huntId,
      p_outcome: operation.outcome,
      p_details: {
        client_report: true, operation_id: operation.id, stage: operation.stage, app,
        ...(operation.recoveryMs === undefined ? {} : { recovery_ms: operation.recoveryMs }),
      },
    })
    return !error
  } catch { return false }
}

export async function reportOperation(huntId: string, operationId: string, stage: string, outcome: OperationOutcome = 'notice', app: OperationApp = 'participant_web') {
  if (!supabase) return
  const key = `${huntId}:${stage}`
  const now = Date.now()
  if (outcome === 'failure' && now - (lastReportAt.get(key) ?? 0) < 60_000) return
  lastReportAt.set(key, now)
  await writeOperation(huntId, app, { id: operationId, stage, outcome })
}

/** Add a privacy-safe authorization marker when a backend denies the operation. */
export function reportOperationFailure(huntId: string, operationId: string, stage: string, error: unknown, app: OperationApp = 'participant_web') {
  void reportOperation(huntId, operationId, stage, 'failure', app)
  if (isAuthorizationFailure(error)) void reportOperation(huntId, operationId, 'authorization_denied', 'failure', app)
}

type RefreshArea = 'player_context' | 'player_challenges' | 'player_submissions' | 'player_progress' | 'player_gallery' | 'chat'

/** Pair the first failed read with its next success. Keep a bounded queue in
 * the open page so an offline failure can still be recorded after recovery. */
export function createRefreshDiagnostics(huntId: string, area: RefreshArea, app: OperationApp = 'participant_web') {
  let incident: { id: string; startedAt: number } | undefined
  let sending = false
  let flushRequested = false
  const pending: Operation[] = []

  async function flush() {
    if (sending) { flushRequested = true; return }
    if (!pending.length) return
    sending = true
    try {
      do {
        flushRequested = false
        while (pending.length) {
          const operation = pending[0]
          if (!await writeOperation(huntId, app, operation)) break
          if (pending[0] === operation) pending.shift()
        }
      } while (flushRequested && pending.length)
    } finally { sending = false }
  }

  function enqueue(operation: Operation) {
    if (pending.length >= 16) {
      // Drop the oldest pending incident as a pair rather than leaving one
      // phase queued indefinitely during a long outage.
      const oldestId = pending[0].id
      while (pending[0]?.id === oldestId) pending.shift()
    }
    pending.push(operation)
    void flush()
  }

  return {
    failed(error?: unknown) {
      if (incident) { void flush(); return }
      incident = { id: crypto.randomUUID(), startedAt: performance.now() }
      enqueue({ id: incident.id, stage: `${area}_refresh_failed`, outcome: 'failure' })
      if (isAuthorizationFailure(error)) void reportOperation(huntId, incident.id, 'authorization_denied', 'failure', app)
    },
    recovered() {
      if (incident) {
        const elapsed = Math.round(performance.now() - incident.startedAt)
        enqueue({ id: incident.id, stage: `${area}_refresh_recovered`, outcome: 'success',
          recoveryMs: Math.min(86_400_000, Math.max(0, elapsed)) })
        incident = undefined
      } else void flush()
    },
  }
}
