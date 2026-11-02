import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Check, CircleHelp, Clock3, LoaderCircle, Medal, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { calculateTeamScores, type ScoringSubmission, type ScoringVote } from '../../lib/scoring'

type HuntReviewProps = { huntId: string; title: string; status: string; onBack: () => void; onChanged: () => void }
type ReviewData = {
  voting_enabled: boolean; voting_bonus_points: number; status: string
  teams: { id: string; name: string; display_color: string }[]
  items: { id: string; title: string; points: number; display_order: number }[]
  submissions: { id: string; item_id: string; team_id: string; participant_id: string; storage_path: string; status: 'pending' | 'approved' | 'rejected'; submitted_at: string; photo_url?: string }[]
  votes: ScoringVote[]
}

export default function HuntReview({ huntId, title, status, onBack, onChanged }: HuntReviewProps) {
  const [data, setData] = useState<ReviewData | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [confirmFinalize, setConfirmFinalize] = useState(false)

  const load = useCallback(async () => {
    if (!supabase) return
    const { data: raw, error: loadError } = await supabase.rpc('get_hunt_review_gallery', { p_hunt_id: huntId })
    if (loadError) { setError(loadError.message); return }
    const next = raw as Omit<ReviewData, 'submissions'> & { submissions: ReviewData['submissions'] }
    const photos = await Promise.all(next.submissions.map(async row => {
      const { data: signed } = await supabase!.storage.from('hunt-photos').createSignedUrl(row.storage_path, 300)
      return { ...row, photo_url: signed?.signedUrl }
    }))
    setData({ ...next, submissions: photos })
    setError('')
  }, [huntId])

  // Initializing the review screen from its database-backed source is intentional.
  // eslint-disable-next-line react/set-state-in-effect
  useEffect(() => { void load() }, [load])

  async function decide(id: string, decision: 'approved' | 'rejected') {
    if (!supabase) return
    setBusy(id); setError('')
    const { error: actionError } = await supabase.rpc('review_submission', { p_submission_id: id, p_decision: decision })
    if (actionError) setError(actionError.message)
    else { await load(); onChanged() }
    setBusy('')
  }

  async function startReview() {
    if (!supabase) return
    setBusy('review'); setError('')
    const { error: actionError } = await supabase.rpc('begin_hunt_review', { p_hunt_id: huntId })
    if (actionError) setError(actionError.message)
    else { await load(); onChanged() }
    setBusy('')
  }

  async function finalize() {
    if (!supabase) return
    setBusy('finalize'); setError('')
    const { error: actionError } = await supabase.rpc('finalize_hunt', { p_hunt_id: huntId })
    if (actionError) setError(actionError.message)
    else { setConfirmFinalize(false); await load(); onChanged() }
    setBusy('')
  }

  const scores = data ? calculateTeamScores(data.teams, data.items.map(item => ({ id: item.id, pointValue: item.points })), data.submissions.map(row => ({ teamId: row.team_id, itemId: row.item_id, approvalStatus: row.status } as ScoringSubmission)), data.votes as ScoringVote[], data.voting_bonus_points) : []
  const pendingCount = data?.submissions.filter(row => row.status === 'pending').length ?? 0
  const ended = ['ended', 'review', 'completed'].includes(status) || ['review', 'completed'].includes(data?.status ?? '')

  return <section className="workspace-content hunt-review-content">
    <button className="back-link" onClick={onBack}><ArrowLeft size={15}/> Back to hunt</button>
    <div className="new-hunt-heading"><div className="eyebrow"><Medal size={14}/> PHOTO REVIEW</div><h1>{title}</h1><p>Approve the photos that meet your hunt rules. Approved photos earn the item’s points.</p></div>
    {error && <div className="form-error" role="alert"><CircleHelp size={15}/>{error}</div>}
    {!data ? <div className="workspace-loading"><LoaderCircle className="spin" size={20}/> Loading the private photo gallery…</div> : <>
      {!ended && <div className="review-action-banner"><Clock3 size={18}/><div><b>Hunt is still running</b><span>Review opens when the scheduled time ends. You can also end it now.</span></div><button className="outline-button" disabled={busy === 'review'} onClick={() => void startReview()}>{busy === 'review' ? 'Ending…' : 'End hunt and review'}</button></div>}
      {ended && <div className="review-summary"><b>{pendingCount ? `${pendingCount} photos need review` : 'All submitted photos reviewed'}</b><span>{data.submissions.length} submitted · {data.teams.length} teams · {data.items.length} challenges</span></div>}
      <div className="review-item-list">{data.items.map(item => <section className="review-item" key={item.id}><header><div><span>CHALLENGE {item.display_order + 1}</span><h2>{item.title}</h2></div><b>{item.points} pts</b></header><div className="review-photos">{data.teams.map(team => {
        const photo = data.submissions.find(row => row.item_id === item.id && row.team_id === team.id)
        return <article className="review-photo-card" key={team.id}><div className="review-photo-team"><span className="team-swatch" style={{ backgroundColor: team.display_color }}/><b>{team.name}</b></div>{photo?.photo_url ? <a href={photo.photo_url} target="_blank" rel="noreferrer"><img src={photo.photo_url} alt={`${team.name} photo for ${item.title}`}/></a> : <div className="review-photo-empty">{photo ? 'Preview unavailable' : 'No photo submitted'}</div>}{photo && <><div className={`review-status status-${photo.status}`}>{photo.status}</div>{photo.status === 'pending' && data.status === 'review' && <div className="review-photo-actions"><button className="approve-button" disabled={busy === photo.id} onClick={() => void decide(photo.id, 'approved')}><Check size={14}/> Approve</button><button className="reject-button" disabled={busy === photo.id} onClick={() => void decide(photo.id, 'rejected')}><X size={14}/> Reject</button></div>}</>}</article>
      })}</div></section>)}</div>
      {data.status === 'completed' ? <section className="scoreboard"><div className="eyebrow"><Medal size={14}/> FINAL RESULTS</div><h2>Hunt complete</h2>{scores.map(score => <div className="score-row" key={score.teamId}><b>#{score.rank} {score.teamName}</b><span>{score.basePoints} points{score.votingBonus ? ` + ${score.votingBonus} voting bonus` : ''}</span><strong>{score.total}</strong></div>)}</section> : ended && <div className="review-finish"><div><b>Ready to publish the results?</b><span>{pendingCount ? 'Every submitted photo must be approved or rejected first.' : 'This locks the final scores and shows the leaderboard to participants.'}</span></div>{confirmFinalize ? <><button className="outline-button" onClick={() => setConfirmFinalize(false)}>Cancel</button><button className="primary-button" disabled={!!pendingCount || busy === 'finalize'} onClick={() => void finalize()}>{busy === 'finalize' ? 'Finalizing…' : 'Confirm final results'}</button></> : <button className="primary-button" disabled={!!pendingCount} onClick={() => setConfirmFinalize(true)}>Finalize results</button>}</div>}
    </>}
  </section>
}
