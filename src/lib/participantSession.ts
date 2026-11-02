import type { SupabaseClient } from '@supabase/supabase-js'

type JoinResult = { hunt_id: string; participant_id: string; title: string }

/** Ask Auth to restore its persisted session before ever creating a guest. */
export async function restoreParticipantSession(client: SupabaseClient, createGuest = false) {
  const { data, error } = await client.auth.getSession()
  if (error) throw error
  if (data.session || !createGuest) return data.session
  const next = await client.auth.signInAnonymously()
  if (next.error) throw next.error
  if (!next.data.session) throw new Error('Could not restore your participant session. Please try again.')
  return next.data.session
}

function checkedResult(data: unknown): JoinResult {
  const row = data as JoinResult | null
  if (!row || typeof row.hunt_id !== 'string' || typeof row.participant_id !== 'string') {
    throw new Error('The game response could not be confirmed. Retry with your existing session.')
  }
  return row
}

export async function resumeInvitation(client: SupabaseClient, token: string): Promise<JoinResult | null> {
  if (!await restoreParticipantSession(client)) return null
  // The existing RPC returns trusted membership before checking the join window.
  // An empty name probes for membership and cannot create a new participant.
  const { data, error } = await client.rpc('redeem_invitation', { p_token: token, p_display_name: '' })
  if (error) {
    if (/^Enter a name up to 40 characters$/i.test(error.message)) return null
    throw error
  }
  return checkedResult(data)
}

export async function joinInvitation(client: SupabaseClient, token: string, name: string): Promise<JoinResult> {
  if (!name.trim() || name.trim().length > 40) throw new Error('Enter a name up to 40 characters')
  await restoreParticipantSession(client, true)
  const { data, error } = await client.rpc('redeem_invitation', { p_token: token, p_display_name: name.trim() })
  if (error) throw error
  return checkedResult(data)
}
