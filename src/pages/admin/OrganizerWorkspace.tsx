import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Archive, ArrowDownUp, Camera, Check, CircleHelp, Clock3, House, Library, LogOut, Plus, Search, ShieldCheck, Sparkles, Users, X, MapPin, ClipboardList, Trash2, ArrowLeft, QrCode, Copy, RefreshCw, CalendarDays, Settings2, UserRound, Play } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'
import { joinInvitation } from '../../lib/participantSession'
import HuntReview from './HuntReview'

type OrganizerWorkspaceProps = { session: Session; onSignOut: () => void; initialHuntId?: string }
type Organizer = { id: string }
type LibraryItem = { id: string; title: string; description: string | null; category: string | null; archived: boolean; created_at: string }
type Hunt = { id: string; title: string; venue: string; status: string; created_at: string; start_at: string | null; duration_minutes: number; team_assignment_mode: 'organizer' | 'balanced'; voting_enabled: boolean; voting_bonus_points: number }
type DraftItem = { key: string; title: string; description: string; pointValue: number; libraryItemId?: string }
type Team = { id: string; hunt_id: string; name: string; display_color: string; display_order: number }
type Participant = { id: string; hunt_id: string; team_id: string; display_name: string; joined_at: string }
type InviteCode = { team_id: string | null; team_name: string; invite_token: string }
type Page = 'overview' | 'library' | 'hunts' | 'new-hunt' | 'manage-hunt' | 'review-hunt'

function localDateTimeValue(value?: string | null) {
  const date = value ? new Date(value) : new Date(Date.now() + 60 * 60 * 1000)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

const SUGGESTED_RULES = [
  { id: 'participant-in-frame', text: 'Every photo should show at least one team participant together with the item.', recommended: true },
  { id: 'stay-in-venue', text: 'Stay within the event venue and areas open to your group.', recommended: false },
  { id: 'respect-others', text: 'Ask permission before including anyone outside your team in a photo.', recommended: false },
  { id: 'play-safely', text: 'Walk, stay together, and skip anything that feels unsafe.', recommended: false },
]

export default function OrganizerWorkspace({ session, onSignOut, initialHuntId }: OrganizerWorkspaceProps) {
  const [page, setPage] = useState<Page>('overview')
  const [organizer, setOrganizer] = useState<Organizer | null>(null)
  const [items, setItems] = useState<LibraryItem[]>([])
  const [hunts, setHunts] = useState<Hunt[]>([])
  const [huntSchemaReady, setHuntSchemaReady] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formMessage, setFormMessage] = useState('')
  const [venue, setVenue] = useState('')
  const [huntTitle, setHuntTitle] = useState('')
  const [huntDuration, setHuntDuration] = useState(60)
  const [selectedRules, setSelectedRules] = useState<string[]>([SUGGESTED_RULES[0].text])
  const [draftItems, setDraftItems] = useState<DraftItem[]>([])
  const [huntSaving, setHuntSaving] = useState(false)
  const [huntMessage, setHuntMessage] = useState('')
  const [managedHunt, setManagedHunt] = useState<Hunt | null>(null)
  const [teamNamesText, setTeamNamesText] = useState('Team Red\nTeam Blue')
  const [assignmentMode, setAssignmentMode] = useState<'organizer' | 'balanced'>('organizer')
  const [startAtLocal, setStartAtLocal] = useState(localDateTimeValue())
  const [votingEnabled, setVotingEnabled] = useState(false)
  const [votingBonusPoints, setVotingBonusPoints] = useState(0)
  const [inviteCodes, setInviteCodes] = useState<InviteCode[]>([])
  const [managedTeams, setManagedTeams] = useState<Team[]>([])
  const [managedParticipants, setManagedParticipants] = useState<Participant[]>([])
  const [manageSaving, setManageSaving] = useState(false)
  const [manageMessage, setManageMessage] = useState('')
  const [copiedInvite, setCopiedInvite] = useState('')

  const loadWorkspace = useCallback(async () => {
    if (!supabase) return
    const profile = await supabase.from('organizers').select('id').eq('auth_user_id', session.user.id).maybeSingle()
    setLoadError('')
    if (profile.error) {
      setLoadError(profile.error.message)
      setLoading(false)
      return
    }
    if (!profile.data) {
      setLoadError('Your account is signed in but has not been provisioned as an organizer.')
      setLoading(false)
      return
    }
    setOrganizer(profile.data)
    const library = await supabase.from('library_items').select('id,title,description,category,archived,created_at').eq('organizer_id', profile.data.id).order('created_at', { ascending: false })
    if (library.error) setLoadError(library.error.message)
    else setItems(library.data ?? [])
    const huntList = await supabase.from('hunts').select('id,title,venue,status,created_at,start_at,duration_minutes,team_assignment_mode,voting_enabled,voting_bonus_points').eq('organizer_id', profile.data.id).order('created_at', { ascending: false })
    if (huntList.error) {
      setHunts([])
      if (huntList.error.code === 'PGRST205' || huntList.error.code === '42P01') setHuntSchemaReady(false)
      else setLoadError(huntList.error.message)
    } else {
      setHunts((huntList.data ?? []).map(hunt => (
        ['scheduled','active'].includes(hunt.status) && hunt.start_at
          && Date.now() >= new Date(hunt.start_at).getTime() + hunt.duration_minutes * 60_000
          ? { ...hunt, status: 'ended' }
          : hunt
      )))
      setHuntSchemaReady(true)
    }
    setLoading(false)
  }, [session.user.id])

  // Loading the organizer's remote data when the authenticated session changes is intentional.
  // eslint-disable-next-line react/set-state-in-effect
  useEffect(() => { void loadWorkspace() }, [loadWorkspace])

  useEffect(() => {
    if (!initialHuntId || managedHunt || loading) return
    const hunt = hunts.find(row => row.id === initialHuntId)
    if (hunt) void openManageHunt(hunt)
  }, [hunts, initialHuntId, loading, managedHunt])

  async function addItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !organizer) return
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const title = String(form.get('title') ?? '').trim()
    const description = String(form.get('description') ?? '').trim()
    const category = String(form.get('category') ?? '').trim()
    if (!title) { setFormMessage('Give your challenge a name first.'); return }
    setSaving(true); setFormMessage('')
    const { error } = await supabase.from('library_items').insert({ organizer_id: organizer.id, title, description: description || null, category: category || null })
    if (error) setFormMessage(error.message)
    else { formElement.reset(); setShowForm(false); await loadWorkspace() }
    setSaving(false)
  }

  async function toggleArchived(item: LibraryItem) {
    if (!supabase) return
    const { error } = await supabase.from('library_items').update({ archived: !item.archived }).eq('id', item.id)
    if (error) setLoadError(error.message)
    else setItems(current => current.map(row => row.id === item.id ? { ...row, archived: !row.archived } : row))
  }

  function addDraftItem() {
    setDraftItems(current => [...current, { key: crypto.randomUUID(), title: '', description: '', pointValue: 1 }])
  }

  function addLibraryChallenge(item: LibraryItem) {
    setDraftItems(current => current.some(draft => draft.libraryItemId === item.id) ? current : [...current, {
      key: crypto.randomUUID(), title: item.title, description: item.description ?? '', pointValue: 1, libraryItemId: item.id,
    }])
  }

  function updateDraftItem(key: string, field: keyof Omit<DraftItem, 'key'>, value: string | number) {
    setDraftItems(current => current.map(item => item.key === key ? { ...item, [field]: value } : item))
  }

  async function createHunt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setHuntMessage('')
    if (!supabase) return
    if (!huntSchemaReady) { setHuntMessage('The venue-hunt database setup is not active yet.'); return }
    if (!venue.trim()) { setHuntMessage('Enter a venue before adding the hunt list.'); return }
    const readyItems = draftItems.filter(item => item.title.trim())
    if (!readyItems.length) { setHuntMessage('Add at least one photo challenge.'); return }
    const title = huntTitle.trim() || `${venue.trim()} Photo Hunt`
    if (title.length > 120) { setHuntMessage('The hunt title must be 120 characters or fewer.'); return }
    setHuntSaving(true)
    try {
      const { error } = await supabase.rpc('create_hunt_draft', {
        p_title: title,
        p_venue: venue.trim(),
        p_rules: selectedRules,
        p_items: readyItems.map(({ title: itemTitle, description, pointValue, libraryItemId }) => ({ title: itemTitle.trim(), description: description.trim() || null, pointValue, libraryItemId })),
        p_duration_minutes: huntDuration,
      })
      if (error) { setHuntMessage(error.message); return }
      setVenue(''); setHuntTitle(''); setHuntDuration(60); setDraftItems([])
      setSelectedRules([SUGGESTED_RULES[0].text])
      await loadWorkspace()
      setPage('hunts')
    } catch (error) {
      setHuntMessage(error instanceof Error ? error.message : 'Could not save the draft hunt.')
    } finally {
      setHuntSaving(false)
    }
  }

  async function openManageHunt(hunt: Hunt) {
    setManagedHunt(hunt)
    setTeamNamesText('Team Red\nTeam Blue')
    setAssignmentMode(hunt.team_assignment_mode || 'organizer')
    setStartAtLocal(localDateTimeValue(hunt.start_at))
    setVotingEnabled(hunt.voting_enabled)
    setVotingBonusPoints(hunt.voting_bonus_points)
    setInviteCodes([])
    setManagedTeams([])
    setManagedParticipants([])
    setManageMessage('')
    setPage('manage-hunt')
    if (hunt.status !== 'draft' && supabase) {
      const [teamResult, participantResult] = await Promise.all([
        supabase.from('teams').select('id,hunt_id,name,display_color,display_order').eq('hunt_id', hunt.id).order('display_order'),
        supabase.from('participants').select('id,hunt_id,team_id,display_name,joined_at').eq('hunt_id', hunt.id).order('joined_at'),
      ])
      if (teamResult.error) setManageMessage(teamResult.error.message)
      else setManagedTeams(teamResult.data ?? [])
      if (participantResult.error) setManageMessage(participantResult.error.message)
      else setManagedParticipants(participantResult.data ?? [])
    }
  }

  async function publishHunt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !managedHunt) return
    setManageMessage('')
    const teamNames = teamNamesText.split('\n').map(name => name.trim()).filter(Boolean)
    if (new Set(teamNames.map(name => name.toLowerCase())).size !== teamNames.length) {
      setManageMessage('Team names must be unique.')
      return
    }
    const startTime = new Date(startAtLocal)
    if (!Number.isFinite(startTime.getTime()) || startTime.getTime() <= Date.now()) {
      setManageMessage('Choose a start time in the future.')
      return
    }
    setManageSaving(true)
    try {
      const { data, error } = await supabase.rpc('publish_hunt', {
        p_hunt_id: managedHunt.id,
        p_team_names: teamNames,
        p_assignment_mode: assignmentMode,
        p_start_at: startTime.toISOString(),
        p_voting_enabled: votingEnabled,
        p_voting_bonus_points: votingEnabled ? votingBonusPoints : 0,
      })
      if (error) { setManageMessage(error.message); return }
      const codes = (data ?? []) as InviteCode[]
      setInviteCodes(codes)
      setManagedHunt({ ...managedHunt, status: 'scheduled', start_at: startTime.toISOString(), team_assignment_mode: assignmentMode, voting_enabled: votingEnabled, voting_bonus_points: votingBonusPoints })
      await loadWorkspace()
      const [teamResult, participantResult] = await Promise.all([
        supabase.from('teams').select('id,hunt_id,name,display_color,display_order').eq('hunt_id', managedHunt.id).order('display_order'),
        supabase.from('participants').select('id,hunt_id,team_id,display_name,joined_at').eq('hunt_id', managedHunt.id).order('joined_at'),
      ])
      setManagedTeams(teamResult.data ?? [])
      setManagedParticipants(participantResult.data ?? [])
    } catch (error) {
      setManageMessage(error instanceof Error ? error.message : 'Could not publish the hunt.')
    } finally {
      setManageSaving(false)
    }
  }

  async function regenerateInvites() {
    if (!supabase || !managedHunt) return
    setManageSaving(true); setManageMessage('')
    const { data, error } = await supabase.rpc('regenerate_hunt_invites', { p_hunt_id: managedHunt.id })
    if (error) setManageMessage(error.message)
    else { setInviteCodes((data ?? []) as InviteCode[]); setCopiedInvite('') }
    setManageSaving(false)
  }

  async function moveParticipant(participant: Participant, teamId: string) {
    if (!supabase || !managedHunt) return
    const { error } = await supabase.rpc('move_participant', { p_participant_id: participant.id, p_team_id: teamId })
    if (error) setManageMessage(error.message)
    else setManagedParticipants(current => current.map(row => row.id === participant.id ? { ...row, team_id: teamId } : row))
  }

  async function endHuntNow() {
    if (!supabase || !managedHunt || !window.confirm('End this hunt now? Participants will no longer be able to submit photos.')) return
    setManageSaving(true); setManageMessage('')
    const { error } = await supabase.rpc('end_hunt_early', { p_hunt_id: managedHunt.id })
    setManageSaving(false)
    if (error) { setManageMessage(error.message); return }
    const reviewHunt = { ...managedHunt, status: 'review' }
    setManagedHunt(reviewHunt)
    await loadWorkspace()
    setPage('review-hunt')
  }

  async function startHuntNow() {
    if (!supabase || !managedHunt || managedHunt.status !== 'scheduled' || !window.confirm('Start this hunt now? Players will enter gameplay immediately.')) return
    setManageSaving(true); setManageMessage('')
    try {
      const { error } = await supabase.rpc('start_game_now', { p_game_id: managedHunt.id })
      if (error) {
        await supabase.rpc('record_audit_event', {
          p_event_type: 'game_start_now',
          p_hunt_id: managedHunt.id,
          p_outcome: 'failure',
          p_details: { message: error.message.slice(0, 500), route: window.location.hash },
        })
        setManageMessage(error.message); return
      }
      const refreshed = await supabase.from('hunts').select('id,title,venue,status,created_at,start_at,duration_minutes,team_assignment_mode,voting_enabled,voting_bonus_points').eq('id', managedHunt.id).single()
      if (refreshed.error) { setManageMessage(refreshed.error.message); return }
      setManagedHunt(refreshed.data as Hunt)
      await loadWorkspace()
    } catch (error) {
      setManageMessage(error instanceof Error ? error.message : 'Could not start the hunt now.')
    } finally {
      setManageSaving(false)
    }
  }

  function inviteUrl(token: string) { return `${window.location.origin}${window.location.pathname}#/join/${token}` }

  async function copyInvite(token: string) {
    try { await navigator.clipboard.writeText(inviteUrl(token)); setCopiedInvite(token) }
    catch { setManageMessage('Copy was blocked by the browser. Select the invitation link and copy it manually.') }
  }

  async function joinTeam(token: string) {
    if (!supabase || !managedHunt) return
    setManageSaving(true); setManageMessage('')
    try {
      const result = await joinInvitation(supabase, token, displayName.trim().slice(0, 40) || 'Organizer')
      window.location.hash = `/play/${result.hunt_id}`
    } catch (error) {
      setManageMessage(error instanceof Error ? error.message : 'Could not join this team.')
    } finally {
      setManageSaving(false)
    }
  }

  const visibleItems = items.filter(item => item.archived === showArchived && `${item.title} ${item.description ?? ''} ${item.category ?? ''}`.toLowerCase().includes(search.toLowerCase()))
  const selectableLibraryItems = items.filter(item => !item.archived && !draftItems.some(draft => draft.libraryItemId === item.id))
  const activeCount = items.filter(item => !item.archived).length
  const displayName = session.user.email?.split('@')[0] || 'Organizer'

  return <div className="workspace">
    <aside className="workspace-sidebar">
      <a className="workspace-brand" href="#"><span><Camera size={18}/></span> SnapQuest</a>
      <div className="workspace-section-label">WORKSPACE</div>
      <button className={`side-link ${page === 'overview' ? 'selected' : ''}`} onClick={() => setPage('overview')}><House size={17}/> Overview</button>
      <button className={`side-link ${page === 'hunts' || page === 'new-hunt' || page === 'manage-hunt' || page === 'review-hunt' ? 'selected' : ''}`} onClick={() => setPage('hunts')}><ClipboardList size={17}/> Your hunts <span className="side-count">{hunts.length}</span></button>
      <button className={`side-link ${page === 'library' ? 'selected' : ''}`} onClick={() => setPage('library')}><Library size={17}/> Challenge library <span className="side-count">{activeCount}</span></button>
      <div className="workspace-section-label space-top">GAME NIGHT</div>
      <button className="side-link" onClick={() => setPage('hunts')}><Clock3 size={17}/> Schedule & results</button>
      <div className="sidebar-bottom"><span className="sidebar-avatar">{displayName.slice(0, 1).toUpperCase()}</span><span className="sidebar-user"><b>{displayName}</b><small>Organizer account</small></span><button aria-label="Sign out" className="icon-button" onClick={onSignOut}><LogOut size={16}/></button></div>
    </aside>
    <main className="workspace-main">
      <header className="workspace-topbar"><div className="breadcrumb">Workspace <span>/</span> {page === 'overview' ? 'Overview' : page === 'library' ? 'Challenge library' : page === 'new-hunt' ? 'New hunt' : page === 'manage-hunt' ? 'Hunt setup' : page === 'review-hunt' ? 'Photo review' : 'Your hunts'}</div><div className="topbar-badge"><ShieldCheck size={15}/> Private organizer space</div></header>
      {loading ? <div className="workspace-loading">Opening your organizer space…</div> : loadError && !organizer ? <section className="workspace-content"><div className="workspace-alert"><CircleHelp size={19}/><div><b>Organizer access needs attention</b><p>{loadError}</p><button className="outline-button" onClick={() => { setLoading(true); setLoadError(''); void loadWorkspace() }}>Try again</button></div></div></section> : page === 'overview' ? <section className="workspace-content">
        <div className="workspace-greeting"><div><div className="eyebrow"><Sparkles size={14}/> YOUR FAMILY GAME NIGHT</div><h1>Welcome in, {displayName}!</h1><p>Your organizer space is ready. Let’s start gathering the fun.</p></div><div className="greeting-sticker"><Camera size={30}/><span>Let’s play!</span></div></div>
        {loadError && <div className="inline-alert">{loadError}</div>}
        <div className="stats-grid"><div className="stat-card"><span className="stat-icon stat-pink"><Sparkles size={18}/></span><small>ACTIVE CHALLENGES</small><b>{activeCount}</b><span>Ready to add to a hunt</span></div><div className="stat-card"><span className="stat-icon stat-yellow"><Users size={18}/></span><small>LIVE OR SCHEDULED</small><b>{hunts.filter(hunt => ['scheduled','active'].includes(hunt.status)).length}</b><span>Ready for participants</span></div><div className="stat-card"><span className="stat-icon stat-lilac"><Clock3 size={18}/></span><small>YOUR HUNTS</small><b>{hunts.length}</b><span>Venue-based photo adventures</span></div></div>
        <div className="home-panels"><article className="panel-card"><div className="panel-heading"><div><span className="eyebrow">START AT A VENUE</span><h2>Plan a photo hunt</h2><p>Choose a venue, add photo challenges, and set the ground rules.</p></div><span className="panel-illustration"><MapPin size={25}/></span></div><button className="primary-button small-button" onClick={() => { setPage('new-hunt'); setHuntMessage('') }}><Plus size={16}/> Create a hunt</button></article><article className="panel-card"><div className="eyebrow">MAKE IT YOURS</div><h2>Challenge library</h2><p>Photo ideas added to a hunt also become reusable challenges for next time.</p><button className="outline-button panel-link" onClick={() => setPage('library')}><Library size={15}/> Open library</button></article></div>
        <div className="workspace-footnote">Hunt rules and challenge lists are saved to your private Supabase project. <ShieldCheck size={14}/></div>
      </section> : page === 'library' ? <section className="workspace-content library-content">
        <div className="library-title-row"><div><div className="eyebrow"><Library size={14}/> REUSABLE IDEAS</div><h1>Challenge library</h1><p>Collect photo prompts now; add them to games as you plan.</p></div><button className="primary-button library-add" onClick={() => { setShowForm(value => !value); setFormMessage('') }}><Plus size={17}/>{showForm ? 'Close form' : 'New challenge'}</button></div>
        {loadError && <div className="inline-alert">{loadError}</div>}
        {showForm && <form className="challenge-form" onSubmit={addItem}><div className="form-header"><div><b>Add a challenge</b><small>Keep it easy to spot and fun to photograph.</small></div><button type="button" className="icon-button" aria-label="Close" onClick={() => setShowForm(false)}><X size={17}/></button></div><div className="form-fields"><label>Challenge name<input name="title" required maxLength={120} placeholder="Something that makes you smile"/></label><label>Category <span className="optional">Optional</span><input name="category" maxLength={80} placeholder="Silly, nature, colors…"/></label><label className="wide-field">Extra instructions <span className="optional">Optional</span><textarea name="description" maxLength={1000} rows={2} placeholder="Add a hint or a fun twist"/></label></div>{formMessage && <div className="form-error" role="alert">{formMessage}</div>}<div className="form-footer"><button type="button" className="outline-button" onClick={() => setShowForm(false)}>Cancel</button><button className="primary-button form-submit" disabled={saving}>{saving ? 'Saving…' : <><Check size={15}/> Save challenge</>}</button></div></form>}
        <div className="library-toolbar"><div className="search-box"><Search size={16}/><input aria-label="Search challenges" placeholder="Search your challenges" value={search} onChange={e => setSearch(e.target.value)}/></div><button className={`outline-button filter-button ${showArchived ? 'filter-active' : ''}`} onClick={() => setShowArchived(value => !value)}><Archive size={15}/>{showArchived ? 'Archived' : 'Active'}<ArrowDownUp size={13}/></button><span className="item-count">{visibleItems.length} {visibleItems.length === 1 ? 'challenge' : 'challenges'}</span></div>
        {loading ? <div className="empty-library">Loading your saved ideas…</div> : visibleItems.length ? <div className="challenge-list">{visibleItems.map(item => <article className="challenge-row" key={item.id}><span className="challenge-mark"><Camera size={18}/></span><div className="challenge-info"><b>{item.title}</b><p>{item.description || 'Ready to capture a fun moment.'}</p></div>{item.category && <span className="category-chip">{item.category}</span>}<button className="icon-button archive-action" title={item.archived ? 'Restore challenge' : 'Archive challenge'} onClick={() => void toggleArchived(item)}><Archive size={16}/></button></article>)}</div> : <div className="empty-library"><span className="empty-icon"><Camera size={24}/></span><b>{search ? 'No matches yet' : showArchived ? 'Nothing archived' : 'Your ideas start here'}</b><p>{search ? 'Try another search.' : showArchived ? 'Archived challenges will show up here.' : 'Add a photo prompt to make it reusable for your future hunts.'}</p>{!search && !showArchived && <button className="outline-button" onClick={() => setShowForm(true)}><Plus size={15}/> Add your first challenge</button>}</div>}
      </section> : page === 'new-hunt' ? <section className="workspace-content new-hunt-content">
        <button className="back-link" onClick={() => setPage('hunts')}><ArrowLeft size={15}/> Back to your hunts</button>
        <div className="new-hunt-heading"><div className="eyebrow"><Sparkles size={14}/> PLAN YOUR ADVENTURE</div><h1>Create a venue hunt</h1><p>Start with where you’ll play, then make a list of things to find and photograph.</p></div>
        <form className="hunt-builder" onSubmit={createHunt}>
          <section className="builder-section"><div className="builder-step">1</div><div className="builder-main"><h2>Choose your venue</h2><p>Where will participants explore?</p><label className="builder-field">Venue name<input value={venue} onChange={event => setVenue(event.target.value)} required maxLength={160} placeholder="e.g. Riverside Park, Main Street Market"/></label><label className="builder-field">Hunt title <span className="optional">Optional — defaults to “[venue] Photo Hunt”</span><input value={huntTitle} onChange={event => setHuntTitle(event.target.value)} maxLength={120} placeholder={venue ? `${venue} Photo Hunt` : 'Saturday Family Photo Hunt'}/></label><label className="builder-field duration-field">Time limit<select value={huntDuration} onChange={event => setHuntDuration(Number(event.target.value))}><option value={30}>30 minutes</option><option value={45}>45 minutes</option><option value={60}>1 hour</option><option value={90}>90 minutes</option><option value={120}>2 hours</option></select></label></div></section>
          <section className={`builder-section ${venue.trim() ? '' : 'builder-locked'}`}><div className="builder-step">2</div><div className="builder-main"><h2>Set the ground rules</h2><p>Suggested rules help everyone know how to play safely and fairly.</p>{!venue.trim() && <div className="locked-note"><MapPin size={15}/> Enter a venue above to continue.</div>}{venue.trim() && <div className="suggested-rules">{SUGGESTED_RULES.map(rule => <label key={rule.id} className="rule-option"><input type="checkbox" checked={selectedRules.includes(rule.text)} onChange={() => setSelectedRules(current => current.includes(rule.text) ? current.filter(text => text !== rule.text) : [...current, rule.text])}/><span>{rule.text}{rule.recommended && <small>Suggested</small>}</span></label>)}</div>}</div></section>
          <section className={`builder-section ${venue.trim() ? '' : 'builder-locked'}`}><div className="builder-step">3</div><div className="builder-main"><div className="builder-items-heading"><div><h2>Build the photo list</h2><p>Add the items participants need to find and photograph.</p></div>{venue.trim() && <button type="button" className="outline-button" onClick={addDraftItem}><Plus size={15}/> Add item</button>}</div>{!venue.trim() ? <div className="locked-note"><ClipboardList size={15}/> Enter a venue above to start your list.</div> : draftItems.length === 0 ? <div className="item-prompt"><span><Camera size={19}/></span><div><b>Your hunt needs at least one photo challenge</b><p>Choose recognizable things participants can find at this venue.</p></div><button type="button" className="outline-button" onClick={addDraftItem}><Plus size={15}/> Add first item</button></div> : <div className="draft-item-list">{draftItems.map((item, index) => <div className="draft-item" key={item.key}><div className="draft-item-number">{index + 1}</div><div className="draft-item-fields"><label>What should they find?<input value={item.title} onChange={event => updateDraftItem(item.key, 'title', event.target.value)} maxLength={120} placeholder="e.g. A colorful sign"/></label><label>Instructions <span className="optional">Optional</span><input value={item.description} onChange={event => updateDraftItem(item.key, 'description', event.target.value)} maxLength={1000} placeholder="Add a clue or photo idea"/></label></div><label className="points-field">Points<input type="number" min={0} max={1000} value={item.pointValue} onChange={event => updateDraftItem(item.key, 'pointValue', Math.max(0, Number(event.target.value)))}/></label><button type="button" aria-label={`Remove item ${index + 1}`} className="icon-button remove-item" onClick={() => setDraftItems(current => current.filter(row => row.key !== item.key))}><Trash2 size={16}/></button></div>)}</div>}{venue.trim() && selectableLibraryItems.length > 0 && <div className="library-picker"><div><b>From your challenge library</b><span>Saved ideas can be reused in any hunt.</span></div><div className="library-picker-list">{selectableLibraryItems.slice(0, 12).map(item => <button type="button" className="library-picker-item" key={item.id} onClick={() => addLibraryChallenge(item)}><span><b>{item.title}</b><small>{item.category || item.description || 'Reusable challenge'}</small></span><Plus size={15}/></button>)}</div></div>}</div></section>
          {huntMessage && <div className="form-error" role="alert">{huntMessage}</div>}
          <div className="builder-actions"><button type="button" className="outline-button" onClick={() => setPage('hunts')}>Cancel</button><button type="submit" className="primary-button save-hunt-button" disabled={huntSaving || !venue.trim() || !draftItems.some(item => item.title.trim())}>{huntSaving ? 'Saving hunt…' : <><Check size={16}/> Save draft hunt</>}</button></div>
        </form>
      </section> : page === 'hunts' ? <section className="workspace-content hunts-content">
        <div className="library-title-row"><div><div className="eyebrow"><ClipboardList size={14}/> YOUR ADVENTURES</div><h1>Your hunts</h1><p>Draft venue hunts and their photo challenge lists.</p></div><button className="primary-button library-add" onClick={() => { setPage('new-hunt'); setHuntMessage('') }}><Plus size={17}/> Create a hunt</button></div>
        {loadError && <div className="inline-alert">{loadError}</div>}
        {hunts.length ? <div className="hunt-list">{hunts.map(hunt => <article className="hunt-card" key={hunt.id}><span className="hunt-card-mark"><Camera size={21}/></span><div className="hunt-card-info"><div className="hunt-card-meta"><span className="draft-badge">{hunt.status}</span><span>{new Date(hunt.created_at).toLocaleDateString()}</span></div><h2>{hunt.title}</h2><p><MapPin size={14}/> {hunt.venue}</p></div>{['ended','review','completed'].includes(hunt.status) && <button className="outline-button" onClick={() => { setManagedHunt(hunt); setPage('review-hunt') }}>{hunt.status === 'completed' ? 'View results' : 'Review photos'}</button>}<button className="outline-button" onClick={() => void openManageHunt(hunt)}>{hunt.status === 'draft' ? 'Set up teams' : 'Manage hunt'}</button></article>)}</div> : <div className="empty-library"><span className="empty-icon"><MapPin size={24}/></span><b>No hunts yet</b><p>Pick a venue and create a photo list to start planning.</p><button className="outline-button" onClick={() => setPage('new-hunt')}><Plus size={15}/> Create your first hunt</button></div>}
      </section> : page === 'manage-hunt' && managedHunt ? <section className="workspace-content new-hunt-content manage-hunt-content">
        <button className="back-link" onClick={() => setPage('hunts')}><ArrowLeft size={15}/> Back to your hunts</button>
        <div className="new-hunt-heading"><div className="eyebrow"><Settings2 size={14}/> HUNT SETUP</div><h1>{managedHunt.title}</h1><p><MapPin size={14}/> {managedHunt.venue} <span className="manage-divider">·</span> {managedHunt.duration_minutes} minute time limit</p></div>
        {manageMessage && <div className="form-error" role="alert">{manageMessage}</div>}
        {managedHunt.status === 'scheduled' && <section className="builder-section"><div className="builder-step"><Play size={15}/></div><div className="builder-main"><h2>Ready to start?</h2><p>Start immediately if your players are ready. This uses the server clock and preserves the roster and invitation links.</p><button type="button" className="primary-button" disabled={manageSaving} onClick={() => void startHuntNow()}><Play size={15}/> Start hunt now</button></div></section>}
        {managedHunt.status === 'draft' ? <form className="hunt-builder" onSubmit={publishHunt}>
          <section className="builder-section"><div className="builder-step"><CalendarDays size={15}/></div><div className="builder-main"><h2>Choose when and how to play</h2><p>Your QR invitations become active as soon as you publish this hunt.</p><label className="builder-field">Scheduled start time<input type="datetime-local" required value={startAtLocal} onChange={event => setStartAtLocal(event.target.value)}/><span className="optional">Shown in your local time zone; saved as UTC.</span></label><label className="builder-field">Team assignment method<select value={assignmentMode} onChange={event => setAssignmentMode(event.target.value as 'organizer' | 'balanced')}><option value="organizer">Participants scan their assigned team's code</option><option value="balanced">One shared code assigns balanced teams</option></select></label><label className="builder-field">Team names <span className="optional">One name per line · 2–12 teams</span><textarea rows={Math.min(8, Math.max(3, teamNamesText.split('\n').length))} maxLength={600} value={teamNamesText} onChange={event => setTeamNamesText(event.target.value)} placeholder={'Team Red\nTeam Blue'} /></label><label className="voting-config"><input type="checkbox" checked={votingEnabled} onChange={event => setVotingEnabled(event.target.checked)}/><span><b>Enable photo voting during review</b><small>Teams can vote for another team's approved photos.</small></span></label>{votingEnabled && <label className="builder-field duration-field">Voting bonus points<input type="number" min={0} max={1000} value={votingBonusPoints} onChange={event => setVotingBonusPoints(Math.max(0, Number(event.target.value)))}/></label>}</div></section>
          <div className="builder-actions"><button type="button" className="outline-button" onClick={() => setPage('hunts')}>Cancel</button><button type="submit" className="primary-button save-hunt-button" disabled={manageSaving}>{manageSaving ? 'Publishing…' : <><QrCode size={16}/> Publish & create QR codes</>}</button></div>
        </form> : <>
      <section className="builder-section"><div className="builder-step"><QrCode size={15}/></div><div className="builder-main invite-builder-main"><div className="builder-items-heading"><div><h2>Team invitations</h2><p>{managedHunt.team_assignment_mode === 'balanced' ? 'Share this one code with everyone. The app will place each person on a smaller team.' : 'Show each code only to the participants assigned to that team.'}</p></div><button className="outline-button" disabled={manageSaving} onClick={() => void regenerateInvites()}><RefreshCw size={14}/> {inviteCodes.length ? 'Replace codes' : 'Create codes'}</button></div>{inviteCodes.length ? <div className="invite-grid">{inviteCodes.map(invite => <article className="invite-card" key={invite.invite_token}><div className="invite-card-top"><span className="team-swatch" style={{backgroundColor: managedTeams.find(team => team.id === invite.team_id)?.display_color ?? '#b88bbf'}}/><b>{invite.team_name}</b></div><QRCodeSVG value={inviteUrl(invite.invite_token)} size={148} level="M" includeMargin/><label className="invite-url-label">Invitation link<input readOnly value={inviteUrl(invite.invite_token)}/></label><button className="outline-button" onClick={() => void copyInvite(invite.invite_token)}><Copy size={14}/>{copiedInvite === invite.invite_token ? 'Copied!' : 'Copy invite link'}</button><button className="outline-button" disabled={manageSaving} onClick={() => void joinTeam(invite.invite_token)}><Users size={14}/> Join this team</button></article>)}</div> : <div className="locked-note"><ShieldCheck size={15}/> Invite tokens are stored as secure hashes. Create or replace the codes to display them; replacing links revokes older QR codes.</div>}{inviteCodes.length > 0 && <button className="outline-button print-invites" onClick={() => window.print()}><QrCode size={14}/> Print team codes</button>}</div></section>
          <section className="builder-section"><div className="builder-step"><Users size={15}/></div><div className="builder-main"><h2>Participants</h2><p>{managedParticipants.length} {managedParticipants.length === 1 ? 'person has' : 'people have'} joined this hunt. You can move participants before the scheduled start.</p>{managedParticipants.length ? <div className="participant-roster">{managedParticipants.map(participant => <div className="participant-roster-row" key={participant.id}><span className="participant-avatar"><UserRound size={15}/></span><b>{participant.display_name}</b><select aria-label={`Team for ${participant.display_name}`} value={participant.team_id} onChange={event => void moveParticipant(participant, event.target.value)} disabled={managedHunt.status !== 'scheduled'}>{managedTeams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></div>)}</div> : <div className="locked-note"><Users size={15}/> The roster fills in as participants join from their invitation links.</div>}{['scheduled','active'].includes(managedHunt.status) && <button className="reject-button end-hunt-button" disabled={manageSaving} onClick={() => void endHuntNow()}><Clock3 size={14}/> End hunt now and review</button>}</div></section>
        </>}
      </section> : page === 'review-hunt' && managedHunt ? <HuntReview huntId={managedHunt.id} title={managedHunt.title} status={managedHunt.status} onBack={() => setPage('hunts')} onChanged={() => void loadWorkspace()} /> : null}
    </main>
  </div>
}
