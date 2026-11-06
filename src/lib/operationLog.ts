import { supabase } from './supabase'

const lastReportAt = new Map<string, number>()
/** Client-side reports are explicitly labeled and contain no media paths or user content. */
export async function reportOperation(huntId: string, operationId: string, stage: string, outcome: 'success' | 'failure' | 'notice' = 'notice') {
  if (!supabase) return
  const key = `${huntId}:${stage}`
  const now = Date.now()
  if (outcome === 'failure' && now - (lastReportAt.get(key) ?? 0) < 60_000) return
  lastReportAt.set(key, now)
  try {
    await supabase.rpc('record_audit_event', {
      p_event_type: 'client_operation',
      p_hunt_id: huntId,
      p_outcome: outcome,
      p_details: { client_report: true, operation_id: operationId, stage, app: 'participant_web' },
    })
  } catch { /* Diagnostics must never interrupt the hunt operation. */ }
}
