import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, CalendarDays, Check, ClipboardList, LoaderCircle, RefreshCw, Search, ShieldCheck, Trash2, Users, X } from 'lucide-react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'
import '../../systemAdmin.css'

type AdminAccount = {
  id: string; email: string; confirmed: boolean; createdAt: string; lastSignInAt: string | null
  isAdmin: boolean; templates: number; games: number
}
type AdminTemplate = {
  id: string; title: string; venue: string; visibility: 'public' | 'personal'
  creator: string; owner: string; createdAt: string
}
type AdminGame = { id: string; title: string; venue: string; status: string; owner: string; createdAt: string }
type DeletionJob = { id: string; kind: 'account' | 'game'; stage: 'storage' | 'auth'; created_at: string }
type Snapshot = { accounts: AdminAccount[]; templates: AdminTemplate[]; games: AdminGame[]; totalAccounts: number; totalTemplates: number; totalGames: number; deletionJobs?: DeletionJob[] }
type DeletionPreview = {
  userId: string; email: string; publicTemplatesToTransfer: number; privateTemplatesToDelete: number
  draftGamesToDelete: number; completedGamesToPreserve: number
  activeGamesToResolve: { id: string; title: string; status: string }[]
  participantsToAnonymize: number; messagesToRemove: number; ownedStorageObjectsToRemove: number; canDelete: boolean
}
type PendingAction =
  | { kind: 'account'; id: string; title: string; preview: DeletionPreview; confirmation: string }
  | { kind: 'template' | 'game'; id: string; title: string; confirmation: string }

type Props = { session: Session; onSignOut: () => void }

async function invokeAdmin<T>(body: Record<string, unknown>) {
  if (!supabase) throw new Error('SnapQuest is not connected to Supabase.')
  const { data, error } = await supabase.functions.invoke('system-admin', { body })
  if (error) {
    const response = (error as { context?: Response }).context
    if (response) {
      try {
        const detail = await response.clone().json() as { error?: string }
        throw new Error(detail.error || error.message)
      } catch (readError) {
        if (readError instanceof Error && readError.message !== 'Unexpected end of JSON input') throw readError
      }
    }
    throw new Error(error.message || 'The administrative request failed.')
  }
  return data as T
}

function dateLabel(value: string | null) {
  if (!value) return 'Never'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleDateString()
}

function statusLabel(value: string) {
  return ({ draft: 'Draft', scheduled: 'Scheduled', active: 'Live', review: 'In review', completed: 'Completed', archived: 'Archived' } as Record<string, string>)[value] ?? value
}

export default function SystemAdminWorkspace({ session, onSignOut }: Props) {
  const [access, setAccess] = useState<'checking' | 'allowed' | 'denied'>('checking')
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [tab, setTab] = useState<'accounts' | 'templates' | 'games'>('accounts')
  const [search, setSearch] = useState('')
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const loadSnapshot = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await invokeAdmin<Snapshot>({ action: 'snapshot' })
      setSnapshot(data)
      setAccess('allowed')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load the admin workspace.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void invokeAdmin<{ isAdmin: boolean }>({ action: 'check' }).then(result => {
      if (cancelled) return
      if (!result.isAdmin) { setAccess('denied'); setLoading(false); return }
      setAccess('allowed')
      void loadSnapshot()
    }).catch(() => {
      if (!cancelled) { setAccess('denied'); setLoading(false) }
    })
    return () => { cancelled = true }
  }, [loadSnapshot, session.user.id])

  const filteredAccounts = useMemo(() => (snapshot?.accounts ?? []).filter(account =>
    `${account.email} ${account.confirmed ? 'confirmed' : 'awaiting confirmation'}`.toLowerCase().includes(search.trim().toLowerCase())), [snapshot, search])
  const filteredTemplates = useMemo(() => (snapshot?.templates ?? []).filter(template =>
    `${template.title} ${template.venue} ${template.creator} ${template.owner} ${template.visibility}`.toLowerCase().includes(search.trim().toLowerCase())), [snapshot, search])
  const filteredGames = useMemo(() => (snapshot?.games ?? []).filter(game =>
    `${game.title} ${game.venue} ${game.owner} ${game.status}`.toLowerCase().includes(search.trim().toLowerCase())), [snapshot, search])

  async function beginAccountDeletion(account: AdminAccount) {
    setBusy(true); setError(''); setNotice('')
    try {
      const preview = await invokeAdmin<DeletionPreview>({ action: 'preview-delete-account', userId: account.id })
      setPending({ kind: 'account', id: account.id, title: account.email, preview, confirmation: '' })
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : 'Could not prepare the account deletion.')
    } finally { setBusy(false) }
  }

  function beginTemplateDeletion(template: AdminTemplate) {
    setError(''); setNotice('')
    setPending({ kind: 'template', id: template.id, title: template.title, confirmation: '' })
  }

  function beginGameDeletion(game: AdminGame) {
    setError(''); setNotice('')
    setPending({ kind: 'game', id: game.id, title: game.title, confirmation: '' })
  }

  async function confirmPendingAction(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!pending || busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      const body = pending.kind === 'account'
        ? { action: 'delete-account', userId: pending.id, confirmation: pending.confirmation }
        : pending.kind === 'template'
          ? { action: 'delete-template', templateId: pending.id, confirmation: pending.confirmation }
          : { action: 'delete-game', gameId: pending.id, confirmation: pending.confirmation }
      await invokeAdmin(body)
      const completed = pending.kind === 'account' ? 'Account removed. Published templates and completed game records were preserved according to the selected policy.' : pending.kind === 'template' ? 'Hunt template deleted.' : 'Game and its stored media deleted.'
      setPending(null)
      setNotice(completed)
      await loadSnapshot()
    } catch (actionError) {
      if (pending.kind !== 'template') {
        setPending(null)
        await loadSnapshot()
      }
      setError(actionError instanceof Error ? actionError.message : 'The administrative action failed.')
    } finally { setBusy(false) }
  }

  async function resumeDeletion(job: DeletionJob) {
    setBusy(true); setError(''); setNotice('')
    try {
      await invokeAdmin({ action: 'resume-deletion', jobId: job.id })
      setNotice(job.kind === 'account' ? 'Account deletion completed.' : 'Game deletion completed.')
      await loadSnapshot()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Could not resume deletion.')
    } finally { setBusy(false) }
  }

  if (access === 'checking' || loading && !snapshot) {
    return <main className="system-admin-state"><LoaderCircle className="system-admin-spin" size={24}/><p role="status">Checking administrator access…</p></main>
  }

  if (access === 'denied') {
    return <main className="system-admin-state"><ShieldCheck size={30}/><h1>System admin access required</h1><p>This account does not have the SnapQuest system administrator role.</p><a className="outline-button" href="#">Return to SnapQuest</a></main>
  }

  return <div className="system-admin-shell">
    <header className="system-admin-header">
      <a className="system-admin-brand" href="#"><span><ShieldCheck size={18}/></span> SnapQuest <b>ADMIN</b></a>
      <div className="system-admin-header-actions"><span>{session.user.email}</span><button className="outline-button" onClick={() => { window.location.hash = ''; }}> <ArrowLeft size={15}/> Organizer workspace</button><button className="outline-button" onClick={onSignOut}>Sign out</button></div>
    </header>

    <main className="system-admin-main">
      <div className="system-admin-heading"><div><p className="system-admin-eyebrow">SYSTEM ADMINISTRATION</p><h1>Manage SnapQuest</h1><p>Review organizer accounts, reusable hunt templates, and game history.</p></div><button className="outline-button" onClick={() => void loadSnapshot()} disabled={loading}><RefreshCw size={15} className={loading ? 'system-admin-spin' : ''}/> Refresh</button></div>

      <section className="system-admin-summary" aria-label="SnapQuest totals">
        <article><Users size={18}/><span>Organizer accounts</span><b>{snapshot?.totalAccounts ?? 0}</b></article>
        <article><ClipboardList size={18}/><span>Hunt templates</span><b>{snapshot?.totalTemplates ?? 0}</b></article>
        <article><CalendarDays size={18}/><span>Game sessions</span><b>{snapshot?.totalGames ?? 0}</b></article>
      </section>

      <section className="system-admin-panel">
        <div className="system-admin-toolbar">
          <div className="system-admin-tabs" role="tablist" aria-label="Admin data">
            <button role="tab" aria-selected={tab === 'accounts'} onClick={() => { setTab('accounts'); setSearch('') }}>Accounts <span>{snapshot?.totalAccounts ?? 0}</span></button>
            <button role="tab" aria-selected={tab === 'templates'} onClick={() => { setTab('templates'); setSearch('') }}>Templates <span>{snapshot?.totalTemplates ?? 0}</span></button>
            <button role="tab" aria-selected={tab === 'games'} onClick={() => { setTab('games'); setSearch('') }}>Games <span>{snapshot?.totalGames ?? 0}</span></button>
          </div>
          <label className="system-admin-search"><Search size={16}/><span className="sr-only">Search this list</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={tab === 'accounts' ? 'Search organizer email' : 'Search title, venue, or creator'}/></label>
        </div>

        {notice && <p className="system-admin-notice" role="status"><Check size={16}/>{notice}</p>}
        {error && <p className="system-admin-error" role="alert">{error}</p>}
        {loading && <p className="system-admin-loading" role="status"><LoaderCircle size={17} className="system-admin-spin"/> Loading admin data…</p>}

        {Boolean(snapshot?.deletionJobs?.length) && <section className="system-admin-list" aria-label="Pending deletions">
          {snapshot?.deletionJobs?.map(job => <article className="system-admin-row" key={job.id}>
            <div className="system-admin-row-copy"><b>{job.kind === 'account' ? 'Account deletion' : 'Game deletion'}</b><span>{job.stage === 'storage' ? 'Media cleanup pending' : 'Sign-in account cleanup pending'} · Started {dateLabel(job.created_at)}</span></div>
            <button className="outline-button" disabled={busy} onClick={() => void resumeDeletion(job)}>Resume deletion</button>
          </article>)}
        </section>}

        {!loading && tab === 'accounts' && <div className="system-admin-list">
          {filteredAccounts.map(account => <article className="system-admin-row" key={account.id}>
            <div className="system-admin-row-icon"><Users size={18}/></div><div className="system-admin-row-copy"><b>{account.email}</b><span>{account.confirmed ? 'Email confirmed' : 'Awaiting email confirmation'} · Created {dateLabel(account.createdAt)}</span><small>{account.templates} templates · {account.games} games{account.isAdmin ? ' · System admin' : ''}</small></div>
            <button className="system-admin-delete" disabled={busy || account.isAdmin} onClick={() => void beginAccountDeletion(account)}><Trash2 size={15}/> Delete account</button>
          </article>)}
          {filteredAccounts.length === 0 && <p className="system-admin-empty">No organizer accounts match this search.</p>}
        </div>}

        {!loading && tab === 'templates' && <div className="system-admin-list">
          {filteredTemplates.map(template => <article className="system-admin-row" key={template.id}>
            <div className="system-admin-row-icon"><ClipboardList size={18}/></div><div className="system-admin-row-copy"><b>{template.title}</b><span>{template.venue} · {template.visibility === 'public' ? 'Public template' : 'Personal template'}</span><small>Creator: {template.creator} · Owner: {template.owner} · Created {dateLabel(template.createdAt)}</small></div>
            <button className="system-admin-delete" disabled={busy} onClick={() => beginTemplateDeletion(template)}><Trash2 size={15}/> Delete template</button>
          </article>)}
          {filteredTemplates.length === 0 && <p className="system-admin-empty">No hunt templates match this search.</p>}
        </div>}

        {!loading && tab === 'games' && <div className="system-admin-list">
          {filteredGames.map(game => <article className="system-admin-row" key={game.id}>
            <div className="system-admin-row-icon"><CalendarDays size={18}/></div><div className="system-admin-row-copy"><b>{game.title}</b><span>{game.venue} · <em className={`system-admin-status status-${game.status}`}>{statusLabel(game.status)}</em></span><small>Owner: {game.owner} · Created {dateLabel(game.createdAt)}</small></div>
            <button className="system-admin-delete" disabled={busy} onClick={() => beginGameDeletion(game)}><Trash2 size={15}/> Delete game</button>
          </article>)}
          {filteredGames.length === 0 && <p className="system-admin-empty">No game sessions match this search.</p>}
        </div>}
      </section>
    </main>

    {pending && <div className="system-admin-backdrop" role="presentation">
      <section className="system-admin-dialog" role="dialog" aria-modal="true" aria-labelledby="system-admin-dialog-title">
        <button type="button" className="system-admin-dialog-close" aria-label="Cancel" onClick={() => setPending(null)}><X size={18}/></button>
        <p className="system-admin-eyebrow">PERMANENT ACTION</p>
        <h2 id="system-admin-dialog-title">{pending.kind === 'account' ? 'Delete this account?' : pending.kind === 'template' ? 'Delete this hunt template?' : 'Delete this game?'}</h2>
        <p className="system-admin-confirm-name">{pending.title}</p>
        {pending.kind === 'account' ? <>
          <ul className="system-admin-impact-list">
            <li>{pending.preview.publicTemplatesToTransfer} public templates move to SnapQuest Community.</li>
            <li>{pending.preview.privateTemplatesToDelete} personal templates and {pending.preview.draftGamesToDelete} draft games are deleted.</li>
            <li>{pending.preview.completedGamesToPreserve} completed or archived games and their final scores stay in SnapQuest Community history.</li>
            <li>{pending.preview.participantsToAnonymize} participant records are detached from this account; {pending.preview.messagesToRemove} authored chat messages are removed.</li>
            <li>{pending.preview.ownedStorageObjectsToRemove} files owned by this account are deleted. Other players' files remain.</li>
          </ul>
          {pending.preview.activeGamesToResolve.length > 0 && <div className="system-admin-blocker"><b>Resolve these games first</b><ul>{pending.preview.activeGamesToResolve.map(game => <li key={game.id}>{game.title} · {statusLabel(game.status)}</li>)}</ul><p>Delete these games from the Games tab, or finish them before removing the account.</p></div>}
        </> : pending.kind === 'template' ? <p>It will disappear from the hunt catalog. Existing game records retain their saved template snapshot.</p> : <p>This permanently removes the game, teams, invitations, participants, scores, chat, and all files stored for it.</p>}

        <form onSubmit={event => void confirmPendingAction(event)}>
          <label className="system-admin-confirm-field">Type {pending.kind === 'account' ? 'the account email' : 'the title'} to confirm<input autoFocus value={pending.confirmation} onChange={event => setPending(current => current ? { ...current, confirmation: event.target.value } : null)} /></label>
          <div className="system-admin-dialog-actions"><button type="button" className="outline-button" onClick={() => setPending(null)} disabled={busy}>Cancel</button><button type="submit" className="system-admin-delete-confirm" disabled={busy || (pending.kind === 'account' && !pending.preview.canDelete) || pending.confirmation !== pending.title}>{busy ? <LoaderCircle size={15} className="system-admin-spin"/> : <Trash2 size={15}/>} Delete</button></div>
        </form>
      </section>
    </div>}
  </div>
}
