import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Archive, ArrowDownUp, ArrowRight, Camera, Check, CircleHelp, Clock3, House, Library, LogOut, Plus, Search, ShieldCheck, Sparkles, Users, X, MapPin, ClipboardList, ArrowLeft, QrCode, CalendarDays, Settings2, UserRound, Play } from 'lucide-react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'
import { reportOperationFailure } from '../../lib/operationLog'
import { joinInvitation } from '../../lib/participantSession'
import HuntReview from './HuntReview'
import HuntChat from '../../components/HuntChat'
import TeamLobby from '../../components/TeamLobby'
import InviteLinksPanel from '../../components/InviteLinksPanel'
import HuntDiagnostics from '../../components/HuntDiagnostics'
import ConfirmDialog from '../../components/ConfirmDialog'
import ChallengeListEditor from '../../components/ChallengeListEditor'
import { importChallenges, SUGGESTED_RULES, validateHuntDraft } from '../../lib/huntEditor'
import type { Challenge } from '../../lib/workspace'

type OrganizerWorkspaceProps = { session: Session; onSignOut: () => void; initialHuntId?: string }
type Organizer = { id: string }
type LibraryItem = { id: string; title: string; description: string | null; category: string | null; archived: boolean; created_at: string }
type Hunt = { id: string; title: string; venue: string; status: string; created_at: string; start_at: string | null; duration_minutes: number; team_assignment_mode: 'organizer' | 'balanced'; voting_enabled: boolean; voting_bonus_points: number }
type DraftItem = { key: string; title: string; description: string; pointValue: number; libraryItemId?: string }
type Team = { id: string; hunt_id: string; name: string; display_color: string; display_order: number; selfieUrl?: string; selfieSubmittedAt?: string; selfiePreviewUnavailable?: boolean }
type Participant = { id: string; hunt_id: string; team_id: string; display_name: string; joined_at: string }
type PlayerGame = { hunt_id: string; team_id: string; team_name: string; hunt_title: string }
type InviteCode = { team_id: string | null; team_name: string; invite_token: string }
type Page = 'overview' | 'library' | 'hunts' | 'new-hunt' | 'manage-hunt' | 'review-hunt' | 'account'

function localDateTimeValue(value?: string | null) {
  const date = value ? new Date(value) : new Date(Date.now() + 60 * 60 * 1000)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

function huntStatusLabel(status: string) {
  return ({ draft: 'Needs setup', scheduled: 'Waiting for teams', active: 'Live now', ended: 'Ready for review', review: 'Ready for review', completed: 'Results published' } as Record<string, string>)[status] ?? status
}

function huntActionLabel(status: string) {
  return ({ draft: 'Continue setup', scheduled: 'Open lobby', active: 'Manage live hunt', ended: 'Review photos', review: 'Review photos', completed: 'View results' } as Record<string, string>)[status] ?? 'Open hunt'
}

function inviteStorageKey(huntId: string) { return `snapquest-invites-${huntId}` }

function clearSavedInvites(huntId: string) {
  try { window.localStorage.removeItem(inviteStorageKey(huntId)) } catch { /* The server is the invitation source of truth. */ }
}

export default function OrganizerWorkspace({ session, onSignOut, initialHuntId }: OrganizerWorkspaceProps) {
  const [page, setPageState] = useState<Page>('hunts')
  const [mobileLayout, setMobileLayout] = useState(() => window.matchMedia('(max-width: 600px)').matches)
  const draftBaseline = useRef('')
  const [pendingPage, setPendingPage] = useState<Page | null>(null)
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
  const [customRuleDraft, setCustomRuleDraft] = useState('')
  const [draftItems, setDraftItems] = useState<DraftItem[]>([])
  const [challengePaste, setChallengePaste] = useState('')
  const [libraryPickerSearch, setLibraryPickerSearch] = useState('')
  const [libraryAddedMessage, setLibraryAddedMessage] = useState('')
  const [stripListMarkers, setStripListMarkers] = useState(false)
  const [huntSaving, setHuntSaving] = useState(false)
  const [editingDraftId, setEditingDraftId] = useState('')
  const [reuseSourceTitle, setReuseSourceTitle] = useState('')
  const [reusingHuntId, setReusingHuntId] = useState('')
  const [huntMessage, setHuntMessage] = useState('')
  const [managedHunt, setManagedHunt] = useState<Hunt | null>(null)
  const [lobbyStatusStale, setLobbyStatusStale] = useState(false)
  const [teamNamesText, setTeamNamesText] = useState('Team Red\nTeam Blue')
  const [assignmentMode, setAssignmentMode] = useState<'organizer' | 'balanced'>('organizer')
  const [startMode, setStartMode] = useState<'manual' | 'scheduled'>('manual')
  const [startAtLocal, setStartAtLocal] = useState(localDateTimeValue())
  const [votingEnabled, setVotingEnabled] = useState(false)
  const [votingBonusPoints, setVotingBonusPoints] = useState(0)
  const [inviteCodes, setInviteCodes] = useState<InviteCode[]>([])
  const [hasActiveInvites, setHasActiveInvites] = useState(false)
  const [inviteRecoveryIncomplete, setInviteRecoveryIncomplete] = useState(false)
  const [inviteRecoveryLoading, setInviteRecoveryLoading] = useState(false)
  const [inviteRecoveryError, setInviteRecoveryError] = useState('')
  const [managedTeams, setManagedTeams] = useState<Team[]>([])
  const [managedParticipants, setManagedParticipants] = useState<Participant[]>([])
  const [playerGames, setPlayerGames] = useState<PlayerGame[]>([])
  const [resumeHuntId, setResumeHuntId] = useState('')
  const [routeMessage, setRouteMessage] = useState('')
  const [processedRouteHuntId, setProcessedRouteHuntId] = useState('')
  const [manageSaving, setManageSaving] = useState(false)
  const [manageMessage, setManageMessage] = useState('')
  const [timingBusy, setTimingBusy] = useState(false)
  const [copiedInvite, setCopiedInvite] = useState('')
  const [creatorDisplayName, setCreatorDisplayName] = useState('Organizer')
  const [displayNameDraft, setDisplayNameDraft] = useState('')
  const [accountMessage, setAccountMessage] = useState('')
  const [accountError, setAccountError] = useState('')
  const [accountBusy, setAccountBusy] = useState(false)
  const [isSystemAdmin, setIsSystemAdmin] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const lobbyRequestId = useRef(0)
  const lobbyRefreshTimer = useRef<number | undefined>(undefined)
  const lobbySelfieUrlCache = useRef(new Map<string, { url: string; expiresAt: number }>())

  useEffect(() => {
    let cancelled = false
    if (!supabase) return
    void supabase.functions.invoke('system-admin', { body: { action: 'check' } }).then(({ data }) => {
      if (!cancelled) setIsSystemAdmin(data?.isAdmin === true)
    }).catch(() => { if (!cancelled) setIsSystemAdmin(false) })
    return () => { cancelled = true }
  }, [session.user.id])

  const loadWorkspace = useCallback(async () => {
    if (!supabase) return
    let profile = await supabase.from('organizers').select('id').eq('auth_user_id', session.user.id).maybeSingle()
    setLoadError('')
    if (profile.error) {
      setLoadError(profile.error.message)
      setLoading(false)
      return
    }
    if (!profile.data) {
      const { error: provisionError } = await supabase.rpc('ensure_my_organizer_profile')
      if (provisionError) {
        setLoadError(provisionError.message)
        setLoading(false)
        return
      }
      profile = await supabase.from('organizers').select('id').eq('auth_user_id', session.user.id).maybeSingle()
    }
    const memberships = await supabase.from('participants').select('hunt_id,team_id').eq('auth_user_id', session.user.id)
    if (!memberships.error && memberships.data?.length) {
      const huntIds = [...new Set(memberships.data.map(row => row.hunt_id))]
      const teamIds = [...new Set(memberships.data.map(row => row.team_id))]
      const [playerHunts, playerTeams] = await Promise.all([
        supabase.from('hunts').select('id,title').in('id', huntIds),
        supabase.from('teams').select('id,name').in('id', teamIds),
      ])
      if (!playerHunts.error && !playerTeams.error) {
        const huntNames = new Map(playerHunts.data.map(row => [row.id, row.title]))
        const teamNames = new Map(playerTeams.data.map(row => [row.id, row.name]))
        setPlayerGames(memberships.data.flatMap(row => {
          const huntTitle = huntNames.get(row.hunt_id)
          const teamName = teamNames.get(row.team_id)
          return huntTitle && teamName ? [{ ...row, hunt_title: huntTitle, team_name: teamName }] : []
        }))
      } else setPlayerGames([])
    } else setPlayerGames([])
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

  const organizerId = organizer?.id
  useEffect(() => {
    if (!supabase || !organizerId) return
    let cancelled = false
    void supabase.from('hunt_creator_profiles').select('display_name').eq('organizer_id', organizerId).maybeSingle().then(({ data, error }) => {
      if (cancelled) return
      if (error) { setAccountError('Your display name could not be loaded. Try again from Account settings.'); return }
      const name = data?.display_name && data.display_name !== 'SnapQuest organizer' ? data.display_name : ''
      setCreatorDisplayName(name || 'Organizer')
      setDisplayNameDraft(name)
    })
    return () => { cancelled = true }
  }, [organizerId])

  useEffect(() => {
    if (!initialHuntId || loading || initialHuntId === processedRouteHuntId) return
    const hunt = hunts.find(row => row.id === initialHuntId)
    // Hash routing arrives from outside React; synchronize the selected workspace once per route.
    // eslint-disable-next-line react/set-state-in-effect
    setProcessedRouteHuntId(initialHuntId)
    if (hunt) {
      setRouteMessage('')
      void openManageHunt(hunt)
    } else {
      setManagedHunt(null)
      setPage('overview')
      setRouteMessage('That hunt is not in your organizer account. Your team membership is unchanged.')
    }
  // The route effect calls the current hunt opener after workspace data loads.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hunts, initialHuntId, loading, processedRouteHuntId])

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
    if (draftItems.length >= 100) { setHuntMessage('A hunt can contain up to 100 photo challenges.'); return }
    setDraftItems(current => [...current, { key: crypto.randomUUID(), title: '', description: '', pointValue: 1 }])
  }

  function addLibraryChallenge(item: LibraryItem) {
    if (draftItems.length >= 100) { setHuntMessage('A hunt can contain up to 100 photo challenges.'); return }
    setDraftItems(current => current.some(draft => draft.libraryItemId === item.id) ? current : [...current, {
      key: crypto.randomUUID(), title: item.title, description: item.description ?? '', pointValue: 1, libraryItemId: item.id,
    }])
    setLibraryAddedMessage(`${item.title} added to this hunt.`)
  }

  function updateDraftChallengeList(challenges: Challenge[]) {
    const previous = new Map(draftItems.map(item => [item.key, item]))
    setDraftItems(challenges.map(challenge => {
      const savedIdea = previous.get(challenge.id)
      return { key: challenge.id, title: challenge.title, description: challenge.description, pointValue: challenge.points,
        ...(savedIdea?.libraryItemId ? { libraryItemId: savedIdea.libraryItemId } : {}) }
    }))
  }

  function importDraftChallenges() {
    try {
      const existing = draftItems.map(item => ({ id: item.key, title: item.title, description: item.description, points: item.pointValue }))
      const imported = importChallenges(challengePaste, existing, () => crypto.randomUUID(), stripListMarkers)
      const previous = new Map(draftItems.map(item => [item.key, item]))
      setDraftItems(imported.map(item => ({ key: item.id, title: item.title, description: item.description, pointValue: item.points, libraryItemId: previous.get(item.id)?.libraryItemId })))
      setChallengePaste('')
      setHuntMessage('')
    } catch (error) {
      setHuntMessage(error instanceof Error ? error.message : 'Could not import these challenges.')
    }
  }

  async function createHunt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setHuntMessage('')
    if (!supabase) return
    if (!huntSchemaReady) { setHuntMessage('Hunt setup is not available yet. Try again later or contact support.'); return }
    if (!venue.trim()) { setHuntMessage('Enter a venue before adding the hunt list.'); return }
    if (customRuleDraft.trim()) { setHuntMessage('Add your custom rule to the rules list before saving.'); return }
    const readyItems = draftItems.filter(item => item.title.trim())
    const title = huntTitle.trim() || `${venue.trim()} Photo Hunt`
    const validationError = validateHuntDraft({
      id: editingDraftId || 'new-draft', title, venue, description: '', creatorId: '', creatorName: '', visibility: 'personal',
      rules: selectedRules, defaultDuration: huntDuration, createdAt: '',
      challenges: readyItems.map(item => ({ id: item.key, title: item.title, description: item.description, points: item.pointValue })),
    })
    if (validationError) { setHuntMessage(validationError); return }
    setHuntSaving(true)
    try {
      const payload = {
        p_title: title,
        p_venue: venue.trim(),
        p_rules: selectedRules,
        p_items: readyItems.map(({ title: itemTitle, description, pointValue, libraryItemId }) => ({ title: itemTitle.trim(), description: description.trim() || null, pointValue, libraryItemId })),
        p_duration_minutes: huntDuration,
      }
      let savedHuntId = editingDraftId
      if (editingDraftId) {
        const { error } = await supabase.rpc('update_hunt_draft', { p_hunt_id: editingDraftId, ...payload })
        if (error) { setHuntMessage(error.message); return }
      } else {
        const { data, error } = await supabase.rpc('create_hunt_draft', payload)
        if (error) { setHuntMessage(error.message); return }
        if (typeof data !== 'string' || !data) { setHuntMessage('Your draft may have been saved, but SnapQuest did not return its ID. Open My hunts and continue the saved draft before trying again.'); return }
        savedHuntId = data
      }
      const { data: savedHunt, error: savedHuntError } = await supabase.from('hunts').select('id,title,venue,status,created_at,start_at,duration_minutes,team_assignment_mode,voting_enabled,voting_bonus_points').eq('id', savedHuntId).maybeSingle()
      if (savedHuntError || !savedHunt) {
        setEditingDraftId(savedHuntId)
        draftBaseline.current = JSON.stringify({ venue, huntTitle, huntDuration, selectedRules, draftItems, challengePaste, stripListMarkers, customRuleDraft })
        await loadWorkspace()
        setHuntMessage('Your draft is saved. SnapQuest could not open the next setup step yet. Retry saving to continue; your changes are kept.')
        return
      }
      draftBaseline.current = JSON.stringify({ venue, huntTitle, huntDuration, selectedRules, draftItems, challengePaste, stripListMarkers, customRuleDraft: '' })
      setVenue(''); setHuntTitle(''); setHuntDuration(60); setDraftItems([]); setChallengePaste(''); setStripListMarkers(false)
      setCustomRuleDraft('')
      setEditingDraftId('')
      setSelectedRules([SUGGESTED_RULES[0].text])
      setReuseSourceTitle('')
      await loadWorkspace()
      openManageHunt(savedHunt as Hunt)
    } catch (error) {
      setHuntMessage(error instanceof Error ? error.message : 'Could not save the draft hunt.')
    } finally {
      setHuntSaving(false)
    }
  }

  async function editSavedDraft(hunt: Hunt) {
    if (!supabase) return
    setHuntSaving(true); setHuntMessage('')
    const [huntResult, itemResult] = await Promise.all([
      supabase.from('hunts').select('id,title,venue,rules,duration_minutes,status').eq('id', hunt.id).maybeSingle(),
      supabase.from('hunt_items').select('id,title_snapshot,description_snapshot,point_value,display_order,library_item_id').eq('hunt_id', hunt.id).order('display_order'),
    ])
    if (huntResult.error || itemResult.error || !huntResult.data || huntResult.data.status !== 'draft') {
      setHuntMessage(huntResult.error?.message ?? itemResult.error?.message ?? 'This hunt is no longer an editable draft.')
      setHuntSaving(false); return
    }
    const restoredItems = (itemResult.data ?? []).map(item => ({ key: item.id, title: item.title_snapshot, description: item.description_snapshot ?? '', pointValue: item.point_value, libraryItemId: item.library_item_id ?? undefined }))
    draftBaseline.current = JSON.stringify({ venue: huntResult.data.venue, huntTitle: huntResult.data.title, huntDuration: huntResult.data.duration_minutes, selectedRules: huntResult.data.rules ?? [], draftItems: restoredItems, challengePaste: '', stripListMarkers: false, customRuleDraft: '' })
    setEditingDraftId(hunt.id); setHuntTitle(huntResult.data.title); setVenue(huntResult.data.venue)
    setCustomRuleDraft('')
    setReuseSourceTitle('')
    setSelectedRules(huntResult.data.rules ?? []); setHuntDuration(huntResult.data.duration_minutes)
    setDraftItems(restoredItems)
    setHuntSaving(false); setPageState('new-hunt')
  }

  async function reuseCompletedHunt(hunt: Hunt) {
    if (!supabase) return
    setReusingHuntId(hunt.id); setHuntMessage('')
    try {
      const [huntResult, itemResult] = await Promise.all([
        supabase.from('hunts').select('id,title,venue,rules,duration_minutes,status').eq('id', hunt.id).maybeSingle(),
        supabase.from('hunt_items').select('id,title_snapshot,description_snapshot,point_value,display_order').eq('hunt_id', hunt.id).order('display_order'),
      ])
      if (huntResult.error || itemResult.error || !huntResult.data || huntResult.data.status !== 'completed') {
        setHuntMessage(huntResult.error?.message ?? itemResult.error?.message ?? 'Only a completed hunt can be used as a starting point.')
        return
      }
      if (!itemResult.data?.length) {
        setHuntMessage('This hunt has no saved photo challenges to copy.')
        return
      }
      const copiedItems = itemResult.data.map(item => ({ key: crypto.randomUUID(), title: item.title_snapshot, description: item.description_snapshot ?? '', pointValue: item.point_value }))
      setEditingDraftId('')
      setReuseSourceTitle(huntResult.data.title)
      setHuntTitle(`${huntResult.data.title} (Rematch)`)
      setVenue(huntResult.data.venue)
      setSelectedRules(huntResult.data.rules ?? [])
      setCustomRuleDraft('')
      setHuntDuration(huntResult.data.duration_minutes)
      setDraftItems(copiedItems)
      setChallengePaste(''); setStripListMarkers(false); setLibraryAddedMessage('')
      setHuntMessage('')
      setPageState('new-hunt')
    } catch (error) {
      setHuntMessage(error instanceof Error ? error.message : 'Could not load this hunt to reuse it.')
    } finally { setReusingHuntId('') }
  }

  async function openManageHunt(hunt: Hunt) {
    setManagedHunt(hunt)
    setLobbyStatusStale(false)
    setResumeHuntId(hunt.id)
    setTeamNamesText('Team Red\nTeam Blue')
    setAssignmentMode(hunt.team_assignment_mode || 'organizer')
    setStartMode(hunt.start_at ? 'scheduled' : 'manual')
    setStartAtLocal(localDateTimeValue(hunt.start_at))
    setVotingEnabled(hunt.voting_enabled)
    setVotingBonusPoints(hunt.voting_bonus_points)
    setInviteCodes([])
    setHasActiveInvites(false)
    setInviteRecoveryIncomplete(false)
    setInviteRecoveryError('')
    clearSavedInvites(hunt.id)
    setManagedTeams([])
    setManagedParticipants([])
    setManageMessage('')
    setPage('manage-hunt')
    if (hunt.status !== 'draft' && supabase) {
      setInviteRecoveryLoading(true)
      try {
        const { data, error } = await supabase.rpc('get_hunt_invites', { p_hunt_id: hunt.id })
        if (error) setInviteRecoveryError('Could not load the team invitation links. Try refreshing the page.')
        else {
          const result = data as { has_active_invites: boolean; recoverable: boolean; invite_codes: InviteCode[] }
          const codes = Array.isArray(result?.invite_codes) ? result.invite_codes : []
          setInviteCodes(codes)
          setHasActiveInvites(result?.has_active_invites === true)
          setInviteRecoveryIncomplete(result?.has_active_invites === true && result?.recoverable !== true)
        }
      } catch {
        setInviteRecoveryError('Could not load the team invitation links. Try refreshing the page.')
      } finally { setInviteRecoveryLoading(false) }
      await loadManagedLobby(hunt.id)
    }
  }

  const loadManagedLobby = useCallback(async (huntId: string) => {
    if (!supabase) return
    const requestId = ++lobbyRequestId.current
    const [teamResult, participantResult, selfieResult, lobbyResult] = await Promise.all([
      supabase.from('teams').select('id,hunt_id,name,display_color,display_order').eq('hunt_id', huntId).order('display_order'),
      supabase.from('participants').select('id,hunt_id,team_id,display_name,joined_at').eq('hunt_id', huntId).order('joined_at'),
      supabase.from('team_selfies').select('team_id,storage_path,submitted_at').eq('hunt_id', huntId),
      supabase.rpc('get_game_lobby', { p_game_id: huntId }),
    ])
    if (teamResult.error) setManageMessage(teamResult.error.message)
    if (participantResult.error) setManageMessage(participantResult.error.message)
    if (selfieResult.error) setManageMessage(selfieResult.error.message)
    if (requestId !== lobbyRequestId.current) return
    if (teamResult.error || participantResult.error || selfieResult.error) { setLobbyStatusStale(true); return }
    const runtimeState = lobbyResult.data?.runtime_state
    if (!lobbyResult.error && ['scheduled', 'active', 'ended', 'review', 'completed'].includes(runtimeState)) {
      setLobbyStatusStale(false)
      setManagedHunt(current => {
        if (current?.id !== huntId) return current
        const startAt = lobbyResult.data?.start_at
        const endsAt = lobbyResult.data?.ends_at
        const duration = typeof startAt === 'string' && typeof endsAt === 'string' && ['scheduled', 'active'].includes(runtimeState)
          ? (Date.parse(endsAt) - Date.parse(startAt)) / 60_000 : NaN
        return { ...current, status: runtimeState, start_at: typeof startAt === 'string' || startAt === null ? startAt : current.start_at, duration_minutes: Number.isInteger(duration) && duration > 0 && duration <= 2_147_483_647 ? duration : current.duration_minutes }
      })
    } else setLobbyStatusStale(true)
    const selfieRows = selfieResult.data ?? []
    const activeSelfiePaths = new Set(selfieRows.map(row => row.storage_path))
    for (const path of lobbySelfieUrlCache.current.keys()) if (!activeSelfiePaths.has(path)) lobbySelfieUrlCache.current.delete(path)
    const teams = await Promise.all((teamResult.data ?? []).map(async team => {
      const selfie = selfieRows.find(row => row.team_id === team.id)
      if (!selfie) return team
      const cached = lobbySelfieUrlCache.current.get(selfie.storage_path)
      if (cached && cached.expiresAt > Date.now() + 30_000) return { ...team, selfieUrl: cached.url, selfieSubmittedAt: selfie.submitted_at }
      const { data, error } = await supabase!.storage.from('hunt-photos').createSignedUrl(selfie.storage_path, 300)
      if (data?.signedUrl) lobbySelfieUrlCache.current.set(selfie.storage_path, { url: data.signedUrl, expiresAt: Date.now() + 270_000 })
      return { ...team, selfieUrl: data?.signedUrl ?? '', selfieSubmittedAt: selfie.submitted_at, selfiePreviewUnavailable: !!error || !data?.signedUrl }
    }))
    if (requestId !== lobbyRequestId.current) return
    setManagedTeams(teams)
    setManagedParticipants(participantResult.data ?? [])
  }, [])

  const requestLobbyRefresh = useCallback((huntId: string) => {
    if (lobbyRefreshTimer.current !== undefined) window.clearTimeout(lobbyRefreshTimer.current)
    lobbyRefreshTimer.current = window.setTimeout(() => {
      lobbyRefreshTimer.current = undefined
      void loadManagedLobby(huntId)
    }, 250)
  }, [loadManagedLobby])

  const activeLobbyHuntId = page === 'manage-hunt' && managedHunt?.status !== 'draft' ? managedHunt?.id : undefined
  useEffect(() => {
    if (!supabase || !activeLobbyHuntId) return
    const huntId = activeLobbyHuntId
    const refreshTimer = lobbyRefreshTimer
    const requestCounter = lobbyRequestId
    const channel = supabase.channel(`organizer-lobby-${huntId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'teams', filter: `hunt_id=eq.${huntId}` }, () => requestLobbyRefresh(huntId))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'participants', filter: `hunt_id=eq.${huntId}` }, () => requestLobbyRefresh(huntId))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_selfies', filter: `hunt_id=eq.${huntId}` }, () => requestLobbyRefresh(huntId))
      .subscribe()
    const reconcile = () => requestLobbyRefresh(huntId)
    const reconcileVisibility = () => { if (document.visibilityState === 'visible') reconcile() }
    window.addEventListener('focus', reconcile)
    window.addEventListener('online', reconcile)
    document.addEventListener('visibilitychange', reconcileVisibility)
    const fallback = window.setInterval(() => { if (document.visibilityState === 'visible') void loadManagedLobby(huntId) }, 15_000)
    return () => {
      ++requestCounter.current
      if (refreshTimer.current !== undefined) window.clearTimeout(refreshTimer.current)
      window.clearInterval(fallback)
      window.removeEventListener('focus', reconcile)
      window.removeEventListener('online', reconcile)
      document.removeEventListener('visibilitychange', reconcileVisibility)
      void supabase?.removeChannel(channel)
    }
  }, [activeLobbyHuntId, loadManagedLobby, requestLobbyRefresh])

  async function publishHunt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !managedHunt) return
    setManageMessage('')
    const teamNames = teamNamesText.split('\n').map(name => name.trim()).filter(Boolean)
    if (new Set(teamNames.map(name => name.toLowerCase())).size !== teamNames.length) {
      setManageMessage('Team names must be unique.')
      return
    }
    const startTime = startMode === 'scheduled' ? new Date(startAtLocal) : null
    if (startMode === 'scheduled' && (!startTime || !Number.isFinite(startTime.getTime()) || startTime.getTime() <= Date.now())) {
      setManageMessage('Choose a start time in the future, or select Start manually.')
      return
    }
    setManageSaving(true)
    try {
      const { data, error } = await supabase.rpc('publish_hunt', {
        p_hunt_id: managedHunt.id,
        p_team_names: teamNames,
        p_assignment_mode: assignmentMode,
        p_start_at: startTime?.toISOString() ?? null,
        p_voting_enabled: votingEnabled,
        p_voting_bonus_points: votingEnabled ? votingBonusPoints : 0,
      })
      if (error) { setManageMessage(error.message); return }
      const codes = (data ?? []) as InviteCode[]
      setInviteCodes(codes)
      setHasActiveInvites(codes.length > 0)
      setInviteRecoveryIncomplete(false)
      setInviteRecoveryError('')
      setManagedHunt({ ...managedHunt, status: 'scheduled', start_at: startTime?.toISOString() ?? null, team_assignment_mode: assignmentMode, voting_enabled: votingEnabled, voting_bonus_points: votingBonusPoints })
      await loadWorkspace()
      await loadManagedLobby(managedHunt.id)
    } catch (error) {
      setManageMessage(error instanceof Error ? error.message : 'Could not publish the hunt.')
    } finally {
      setManageSaving(false)
    }
  }

  async function regenerateInvites() {
    if (!supabase || !managedHunt) return
    if (hasActiveInvites && !window.confirm('Replace these team invitation links? All older QR codes and links will stop working.')) return
    setManageSaving(true); setManageMessage('')
    try {
      const { data, error } = await supabase.rpc('regenerate_hunt_invites', { p_hunt_id: managedHunt.id })
      if (error) { setManageMessage(error.message); return }
      const codes = (data ?? []) as InviteCode[]
      setInviteCodes(codes)
      setHasActiveInvites(codes.length > 0)
      setInviteRecoveryIncomplete(false)
      setInviteRecoveryError('')
      setCopiedInvite('')
    } catch (error) { setManageMessage(error instanceof Error ? error.message : 'Could not create invitation links.') }
    finally { setManageSaving(false) }
  }

  async function moveParticipant(participant: Participant, teamId: string) {
    if (!supabase || !managedHunt) return
    const { error } = await supabase.rpc('move_participant', { p_participant_id: participant.id, p_team_id: teamId })
    if (error) { setManageMessage(error.message); reportOperationFailure(managedHunt.id, crypto.randomUUID(), 'participant_move_failed', error, 'organizer_web') }
    else setManagedParticipants(current => current.map(row => row.id === participant.id ? { ...row, team_id: teamId } : row))
  }

  async function endHuntNow() {
    if (!supabase || !managedHunt || !window.confirm('End this hunt now? Participants will no longer be able to submit photos.')) return
    const operationId = crypto.randomUUID()
    setManageSaving(true); setManageMessage('')
    try {
      const { error } = await supabase.rpc('end_hunt_early', { p_hunt_id: managedHunt.id })
      if (error) { setManageMessage(error.message); reportOperationFailure(managedHunt.id, operationId, 'end_hunt_early_failed', error, 'organizer_web'); return }
      ++lobbyRequestId.current
      const reviewHunt = { ...managedHunt, status: 'review' }
      setManagedHunt(reviewHunt)
      await loadWorkspace()
      setPage('review-hunt')
    } catch (error) {
      setManageMessage(error instanceof Error ? error.message : 'Could not end the hunt now.')
      reportOperationFailure(managedHunt.id, operationId, 'end_hunt_early_uncertain', error, 'organizer_web')
    } finally { setManageSaving(false) }
  }

  async function startHuntNow() {
    if (!supabase || !managedHunt || managedHunt.status !== 'scheduled' || !window.confirm('Start this hunt now? Players will enter gameplay immediately.')) return
    const operationId = crypto.randomUUID()
    setManageSaving(true); setManageMessage('')
    try {
      const { error } = await supabase.rpc('start_game_now', { p_game_id: managedHunt.id })
      if (error) {
        reportOperationFailure(managedHunt.id, operationId, 'start_game_now_failed', error, 'organizer_web')
        setManageMessage(error.message); return
      }
      const refreshed = await supabase.from('hunts').select('id,title,venue,status,created_at,start_at,duration_minutes,team_assignment_mode,voting_enabled,voting_bonus_points').eq('id', managedHunt.id).single()
      if (refreshed.error) { setManageMessage(refreshed.error.message); return }
      ++lobbyRequestId.current
      setManagedHunt(refreshed.data as Hunt)
      await loadWorkspace()
    } catch (error) {
      setManageMessage(error instanceof Error ? error.message : 'Could not start the hunt now.')
      reportOperationFailure(managedHunt.id, operationId, 'start_game_now_uncertain', error, 'organizer_web')
    } finally {
      setManageSaving(false)
    }
  }

  function inviteUrl(token: string) {
    const hostname = window.location.hostname
    const onLoopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
    const base = import.meta.env.DEV && onLoopback && import.meta.env.VITE_LOCAL_NETWORK_ORIGIN
      ? import.meta.env.VITE_LOCAL_NETWORK_ORIGIN
      : `${window.location.origin}${window.location.pathname}`
    return `${base.replace(/\/$/, '')}${window.location.pathname === '/' ? '/' : ''}#/join/${token}`
  }

  function openManagementSection(id: string) {
    const target = document.getElementById(id)
    if (!target) return
    const disclosure = target instanceof HTMLDetailsElement ? target : target.closest('details')
    if (disclosure) disclosure.open = true
    target.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function testInvite(token: string) { window.open(inviteUrl(token), '_blank', 'noopener,noreferrer') }

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

  async function saveCreatorDisplayName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !organizer) return
    const name = displayNameDraft.trim()
    if (!name || name.length > 80) { setAccountError('Enter a display name between 1 and 80 characters.'); return }
    setAccountBusy(true); setAccountError(''); setAccountMessage('')
    try {
      const { error } = await supabase.rpc('set_hunt_creator_name', { p_display_name: name })
      if (error) { setAccountError(error.message); return }
      setCreatorDisplayName(name)
      setDisplayNameDraft(name)
      setAccountMessage('Display name saved. Your email remains private.')
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : 'Could not save your display name.')
    } finally { setAccountBusy(false) }
  }

  async function saveAccountPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    if (newPassword.length < 8) { setAccountError('Use at least 8 characters for your password.'); return }
    if (newPassword !== confirmPassword) { setAccountError('The passwords do not match.'); return }
    setAccountBusy(true); setAccountError(''); setAccountMessage('')
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) { setAccountError(error.message); return }
      setNewPassword(''); setConfirmPassword('')
      setAccountMessage('Password updated.')
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : 'Could not update your password.')
    } finally { setAccountBusy(false) }
  }

  const visibleItems = items.filter(item => item.archived === showArchived && `${item.title} ${item.description ?? ''} ${item.category ?? ''}`.toLowerCase().includes(search.toLowerCase()))
  async function addHuntTime(minutes: number) {
    if (!supabase || !managedHunt || timingBusy) return
    const operationId = crypto.randomUUID()
    setTimingBusy(true); setManageMessage('')
    try {
      const { error } = await supabase.rpc('add_game_time', { p_game_id: managedHunt.id, p_minutes: minutes })
      if (error) { setManageMessage(error.message); reportOperationFailure(managedHunt.id, operationId, 'add_game_time_failed', error, 'organizer_web'); return }
      ++lobbyRequestId.current
      const next = { ...managedHunt, duration_minutes: managedHunt.duration_minutes + minutes }
      setManagedHunt(next); setHunts(current => current.map(hunt => hunt.id === next.id ? next : hunt))
    } catch (error) {
      setManageMessage(error instanceof Error ? error.message : 'Could not add time to the hunt.')
      reportOperationFailure(managedHunt.id, operationId, 'add_game_time_uncertain', error, 'organizer_web')
    } finally { setTimingBusy(false) }
  }

  async function rescheduleHunt() {
    if (!supabase || !managedHunt || !startAtLocal || timingBusy) return
    const startAt = new Date(startAtLocal)
    if (!Number.isFinite(startAt.getTime()) || startAt.getTime() <= Date.now()) { setManageMessage('Choose a future start time.'); return }
    const operationId = crypto.randomUUID()
    setTimingBusy(true); setManageMessage('')
    try {
      const { error } = await supabase.rpc('reschedule_game', { p_game_id: managedHunt.id, p_start_at: startAt.toISOString() })
      if (error) { setManageMessage(error.message); reportOperationFailure(managedHunt.id, operationId, 'reschedule_game_failed', error, 'organizer_web'); return }
      ++lobbyRequestId.current
      const next = { ...managedHunt, start_at: startAt.toISOString() }
      setManagedHunt(next); setHunts(current => current.map(hunt => hunt.id === next.id ? next : hunt))
    } catch (error) {
      setManageMessage(error instanceof Error ? error.message : 'Could not reschedule the hunt.')
      reportOperationFailure(managedHunt.id, operationId, 'reschedule_game_uncertain', error, 'organizer_web')
    } finally { setTimingBusy(false) }
  }

  const inviteWindowOpen = Boolean(managedHunt && ['scheduled','active'].includes(managedHunt.status))

  const selectableLibraryItems = items.filter(item => !item.archived && !draftItems.some(draft => draft.libraryItemId === item.id))
  const filteredLibraryItems = selectableLibraryItems.filter(item => `${item.title} ${item.description ?? ''} ${item.category ?? ''}`.toLowerCase().includes(libraryPickerSearch.trim().toLowerCase()))
  const activeCount = items.filter(item => !item.archived).length
  const displayName = creatorDisplayName || 'Organizer'
  const selectedResumeGame = playerGames.find(game => game.hunt_id === resumeHuntId)
    ?? playerGames.find(game => game.hunt_id === initialHuntId)
    ?? playerGames[0]
  const stageIndex = managedHunt ? ({ draft: 0, scheduled: 1, active: 2, ended: 3, review: 3, completed: 4 } as Record<string, number>)[managedHunt.status] : undefined
  const activeHunts = hunts.filter(hunt => hunt.status === 'active')
  const huntPriority: Record<string, number> = { active: 0, scheduled: 1, ended: 2, review: 2, draft: 3 }
  const unfinishedHunts = hunts.filter(hunt => hunt.status !== 'completed').sort((left, right) => (huntPriority[left.status] ?? 4) - (huntPriority[right.status] ?? 4) || Date.parse(right.created_at) - Date.parse(left.created_at))
  const completedHunts = hunts.filter(hunt => hunt.status === 'completed').sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))

  useEffect(() => {
    const query = window.matchMedia('(max-width: 600px)')
    const update = () => setMobileLayout(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  const draftSnapshot = JSON.stringify({ venue, huntTitle, huntDuration, selectedRules, draftItems, challengePaste, stripListMarkers, customRuleDraft })
  const draftIsDirty = page === 'new-hunt' && draftSnapshot !== draftBaseline.current

  function setPage(nextPage: Page) {
    if (nextPage === 'new-hunt' && page !== 'new-hunt') draftBaseline.current = draftSnapshot
    if (page === 'new-hunt' && nextPage !== page && draftSnapshot !== draftBaseline.current) { setPendingPage(nextPage); return }
    setPageState(nextPage)
  }

  useEffect(() => {
    if (!draftIsDirty) return
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', protect)
    return () => window.removeEventListener('beforeunload', protect)
  }, [draftIsDirty])

  function discardDraftAndNavigate() {
    setVenue(''); setHuntTitle(''); setHuntDuration(60); setDraftItems([]); setChallengePaste(''); setStripListMarkers(false)
    setCustomRuleDraft('')
    setSelectedRules([SUGGESTED_RULES[0].text]); setEditingDraftId(''); setReuseSourceTitle('')
    setPendingPage(null); draftBaseline.current = ''
    if (pendingPage) setPageState(pendingPage)
  }

  function addCustomRule() {
    const rule = customRuleDraft.trim()
    if (!rule) return
    if (selectedRules.some(existing => existing.toLocaleLowerCase() === rule.toLocaleLowerCase())) { setHuntMessage('That rule is already on the list.'); return }
    if (selectedRules.length >= 30) { setHuntMessage('A hunt can contain up to 30 rules.'); return }
    setSelectedRules(current => current.length >= 30 ? current : [...current, rule])
    setCustomRuleDraft('')
    setHuntMessage('')
  }

  function renderHuntCard(hunt: Hunt) {
    return <article className="hunt-card" key={hunt.id}><span className="hunt-card-mark"><Camera size={21}/></span><div className="hunt-card-info"><div className="hunt-card-meta"><span className="draft-badge">{huntStatusLabel(hunt.status)}</span><span>{new Date(hunt.created_at).toLocaleDateString()}</span></div><h2>{hunt.title}</h2><p><MapPin size={14}/> {hunt.venue}</p></div>
      {hunt.status === 'draft' && <button className="outline-button" onClick={() => void editSavedDraft(hunt)}>Continue setup</button>}
      {hunt.status === 'scheduled' && <button className="outline-button" onClick={() => void openManageHunt(hunt)}>Open lobby</button>}
      {hunt.status === 'active' && <button className="outline-button" onClick={() => void openManageHunt(hunt)}>Manage live hunt</button>}
      {['ended','review'].includes(hunt.status) && <button className="outline-button" onClick={() => { setManagedHunt(hunt); setResumeHuntId(hunt.id); setPage('review-hunt') }}>Review photos</button>}
      {hunt.status === 'completed' && <><button className="outline-button" onClick={() => { setManagedHunt(hunt); setResumeHuntId(hunt.id); setPage('review-hunt') }}>View results</button><button className="outline-button" disabled={Boolean(reusingHuntId)} onClick={() => void reuseCompletedHunt(hunt)}>{reusingHuntId === hunt.id ? 'Loading hunt...' : 'Use this hunt again'}</button></>}
    </article>
  }

  return <div className="workspace">
    <aside className="workspace-sidebar">
      <a className="workspace-brand" href="#"><span><Camera size={18}/></span> SnapQuest</a>
      <div className="workspace-section-label">WORKSPACE</div>
      <button className={`side-link ${page === 'overview' ? 'selected' : ''}`} aria-current={page === 'overview' ? 'page' : undefined} onClick={() => setPage('overview')}><House size={17}/> Overview</button>
      <button className={`side-link ${page === 'hunts' || page === 'new-hunt' || page === 'manage-hunt' || page === 'review-hunt' ? 'selected' : ''}`} aria-current={['hunts','new-hunt','manage-hunt','review-hunt'].includes(page) ? 'page' : undefined} onClick={() => setPage('hunts')}><ClipboardList size={17}/> My hunts <span className="side-count">{hunts.length}</span></button>
      <button className={`side-link ${page === 'library' ? 'selected' : ''}`} aria-current={page === 'library' ? 'page' : undefined} onClick={() => setPage('library')}><Library size={17}/> Challenge library <span className="side-count">{activeCount}</span></button>
      <div className="workspace-section-label space-top">ACCOUNT</div>
      <div className="sidebar-bottom"><span className="sidebar-avatar">{displayName.slice(0, 1).toUpperCase()}</span><span className="sidebar-user"><b>{displayName}</b><small>Organizer account</small></span></div>
    </aside>
    <main className="workspace-main">
      <header className="workspace-topbar"><div className="breadcrumb">Workspace <span>/</span> {page === 'overview' ? 'Home' : page === 'library' ? 'Challenge library' : page === 'new-hunt' ? 'New hunt' : page === 'manage-hunt' ? 'Hunt lobby' : page === 'review-hunt' ? 'Results' : page === 'account' ? 'Account settings' : 'My hunts'}</div><div className="topbar-actions">{playerGames.length > 1 && <label className="resume-game-picker"><span className="sr-only">Choose team game</span><select value={selectedResumeGame?.hunt_id ?? ''} onChange={event => setResumeHuntId(event.target.value)}>{playerGames.map(game => <option value={game.hunt_id} key={game.hunt_id}>{game.hunt_title} — {game.team_name}</option>)}</select></label>}{selectedResumeGame && <a className="outline-button" href={`#/play/${selectedResumeGame.hunt_id}`}><Camera size={14}/> Player view · {selectedResumeGame.team_name}</a>}<details className="account-menu"><summary><span className="sidebar-avatar">{displayName.slice(0,1).toUpperCase()}</span><span>{displayName}</span></summary><div className="account-menu-body">{isSystemAdmin && <button className="outline-button" onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); window.location.hash = '/system-admin' }}><ShieldCheck size={15}/> System admin</button>}<button className="outline-button" onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); setAccountMessage(''); setAccountError(''); setPage('account') }}><Settings2 size={15}/> Account settings</button><button className="outline-button" onClick={onSignOut}><LogOut size={15}/> Sign out</button></div></details><div className="topbar-badge"><ShieldCheck size={15}/> Private organizer space</div></div></header>
      {routeMessage && <div className="inline-alert" role="status">{routeMessage}</div>}
      {loading ? <div className="workspace-loading">Opening your organizer space…</div> : loadError && !organizer ? <section className="workspace-content"><div className="workspace-alert"><CircleHelp size={19}/><div><b>Organizer access needs attention</b><p>{loadError}</p>{playerGames.map(game => <a className="outline-button" key={game.hunt_id} href={`#/play/${game.hunt_id}`}><Camera size={14}/> Return to {game.team_name} · {game.hunt_title}</a>)}<button className="outline-button" onClick={() => { setLoading(true); setLoadError(''); void loadWorkspace() }}>Try again</button></div></div></section> : page === 'overview' ? <section className="workspace-content">
        <div className="workspace-greeting"><div><div className="eyebrow"><Sparkles size={14}/> YOUR FAMILY GAME NIGHT</div><h1>Welcome in, {displayName}!</h1><p>Your organizer space is ready. Let’s start gathering the fun.</p></div><div className="greeting-sticker"><Camera size={30}/><span>Let’s play!</span></div></div>
         {loadError && <div className="inline-alert">{loadError}</div>}
        <section className="active-hunts-panel" aria-labelledby="active-hunts-heading">
          <div className="active-hunts-panel-heading">
            <div><span className="eyebrow"><Sparkles size={14}/> YOUR ACTIVE HUNTS</span><h2 id="active-hunts-heading">Manage a hunt in progress</h2><p>Open a live hunt to manage teams, chat, timing, and review.</p></div>
            <span className="active-hunts-count">{activeHunts.length} {activeHunts.length === 1 ? 'live hunt' : 'live hunts'}</span>
          </div>
          {activeHunts.length ? <div className="active-hunt-list">{activeHunts.map(hunt => <article className="active-hunt-row" key={hunt.id} aria-label={`Active hunt: ${hunt.title}`}>
            <span className="active-hunt-indicator" aria-hidden="true"><span/></span>
            <div className="active-hunt-info"><span className="active-hunt-status">LIVE NOW</span><h3>{hunt.title}</h3><p><MapPin size={14}/> {hunt.venue}</p></div>
            <button className="primary-button" onClick={() => void openManageHunt(hunt)}>Manage hunt <ArrowRight size={16}/></button>
          </article>)}</div> : <div className="active-hunts-empty"><span className="active-hunts-empty-icon"><Clock3 size={19}/></span><div><b>No hunts are running right now</b><p>When you start a hunt, it will appear here so you can manage it.</p></div></div>}
        </section>
        <div className="stats-grid"><div className="stat-card"><span className="stat-icon stat-pink"><Sparkles size={18}/></span><small>ACTIVE CHALLENGES</small><b>{activeCount}</b><span>Ready to add to a hunt</span></div><div className="stat-card"><span className="stat-icon stat-yellow"><Users size={18}/></span><small>LIVE OR SCHEDULED</small><b>{hunts.filter(hunt => ['scheduled','active'].includes(hunt.status)).length}</b><span>Ready for participants</span></div><div className="stat-card"><span className="stat-icon stat-lilac"><Clock3 size={18}/></span><small>YOUR HUNTS</small><b>{hunts.length}</b><span>Venue-based photo adventures</span></div></div>
        <div className="home-panels"><article className="panel-card plan-hunt-panel"><div className="panel-heading"><div><span className="eyebrow">PLAN A NEW HUNT</span><h2>Plan a new hunt</h2><p>Choose a venue, add photo challenges, and set the ground rules.</p></div><span className="panel-illustration"><MapPin size={25}/></span></div><button className="primary-button small-button" onClick={() => { setPage('new-hunt'); setHuntMessage('') }}><Plus size={16}/> Start planning</button></article><article className="panel-card"><div className="eyebrow">MAKE IT YOURS</div><h2>Challenge library</h2><p>Photo ideas added to a hunt also become reusable challenges for next time.</p><button className="outline-button panel-link" onClick={() => setPage('library')}><Library size={15}/> Open library</button></article></div>
        <div className="workspace-footnote">Your hunts and challenge lists are private to your organizer account. <ShieldCheck size={14}/></div>
      </section> : page === 'library' ? <section className="workspace-content library-content">
        <div className="library-title-row"><div><div className="eyebrow"><Library size={14}/> REUSABLE IDEAS</div><h1>Challenge library</h1><p>Collect photo prompts now; add them to games as you plan.</p></div><button className="primary-button library-add" onClick={() => { setShowForm(value => !value); setFormMessage('') }}><Plus size={17}/>{showForm ? 'Close form' : 'New challenge'}</button></div>
        {loadError && <div className="inline-alert">{loadError}</div>}
        {showForm && <form className="challenge-form" onSubmit={addItem}><div className="form-header"><div><b>Add a challenge</b><small>Keep it easy to spot and fun to photograph.</small></div><button type="button" className="icon-button" aria-label="Close" onClick={() => setShowForm(false)}><X size={17}/></button></div><div className="form-fields"><label>Challenge name<input name="title" required maxLength={120} placeholder="Something that makes you smile"/></label><label>Category <span className="optional">Optional</span><input name="category" maxLength={80} placeholder="Silly, nature, colors…"/></label><label className="wide-field">Extra instructions <span className="optional">Optional</span><textarea name="description" maxLength={1000} rows={2} placeholder="Add a hint or a fun twist"/></label></div>{formMessage && <div className="form-error" role="alert">{formMessage}</div>}<div className="form-footer"><button type="button" className="outline-button" onClick={() => setShowForm(false)}>Cancel</button><button className="primary-button form-submit" disabled={saving}>{saving ? 'Saving…' : <><Check size={15}/> Save challenge</>}</button></div></form>}
        <div className="library-toolbar"><div className="search-box"><Search size={16}/><input aria-label="Search challenges" placeholder="Search your challenges" value={search} onChange={e => setSearch(e.target.value)}/></div><button className={`outline-button filter-button ${showArchived ? 'filter-active' : ''}`} onClick={() => setShowArchived(value => !value)}><Archive size={15}/>{showArchived ? 'Archived' : 'Active'}<ArrowDownUp size={13}/></button><span className="item-count">{visibleItems.length} {visibleItems.length === 1 ? 'challenge' : 'challenges'}</span></div>
        {loading ? <div className="empty-library">Loading your saved ideas…</div> : visibleItems.length ? <div className="challenge-list">{visibleItems.map(item => <article className="challenge-row" key={item.id}><span className="challenge-mark"><Camera size={18}/></span><div className="challenge-info"><b>{item.title}</b><p>{item.description || 'Ready to capture a fun moment.'}</p></div>{item.category && <span className="category-chip">{item.category}</span>}<button className="icon-button archive-action" title={item.archived ? 'Restore challenge' : 'Archive challenge'} onClick={() => void toggleArchived(item)}><Archive size={16}/></button></article>)}</div> : <div className="empty-library"><span className="empty-icon"><Camera size={24}/></span><b>{search ? 'No matches yet' : showArchived ? 'Nothing archived' : 'Your ideas start here'}</b><p>{search ? 'Try another search.' : showArchived ? 'Archived challenges will show up here.' : 'Add a photo prompt to make it reusable for your future hunts.'}</p>{!search && !showArchived && <button className="outline-button" onClick={() => setShowForm(true)}><Plus size={15}/> Add your first challenge</button>}</div>}
      </section> : page === 'new-hunt' ? <section className="workspace-content new-hunt-content">
        <button className="back-link" onClick={() => setPage('hunts')}><ArrowLeft size={15}/> Back to your hunts</button>
        <div className="new-hunt-heading"><div className="eyebrow"><Sparkles size={14}/> PLAN YOUR ADVENTURE</div><h1>{editingDraftId ? 'Edit your draft hunt' : reuseSourceTitle ? 'Plan a rematch' : 'Create a venue hunt'}</h1><p>{reuseSourceTitle ? `Challenges, venue, and rules copied from “${reuseSourceTitle}”. Saving creates a separate new hunt; the original results stay unchanged.` : 'Start with where you’ll play, then make a list of things to find and photograph.'}</p></div>
        <form className="hunt-builder" onSubmit={createHunt}>
          <section className="builder-section"><div className="builder-step">1</div><div className="builder-main"><h2>Choose your venue</h2><p>Where will participants explore?</p><label className="builder-field">Venue name<input value={venue} onChange={event => setVenue(event.target.value)} required maxLength={160} placeholder="e.g. Riverside Park, Main Street Market"/></label><label className="builder-field">Hunt title <span className="optional">Optional — defaults to “[venue] Photo Hunt”</span><input value={huntTitle} onChange={event => setHuntTitle(event.target.value)} maxLength={120} placeholder={venue ? `${venue} Photo Hunt` : 'Saturday Family Photo Hunt'}/></label><label className="builder-field duration-field">Time limit (minutes)<input type="number" min={1} max={2147483647} step={1} required value={huntDuration} onChange={event => setHuntDuration(Number(event.target.value))}/><span className="optional">Choose any whole-number duration. There is no 24-hour cap.</span></label></div></section>
          <section className={`builder-section ${venue.trim() ? '' : 'builder-locked'}`}><div className="builder-step">2</div><div className="builder-main"><h2>Set the ground rules</h2><p>Keep the suggested rules, or add custom rules for this hunt.</p>{!venue.trim() && <div className="locked-note"><MapPin size={15}/> Enter a venue above to continue.</div>}{venue.trim() && <><div className="suggested-rules">{SUGGESTED_RULES.map(rule => <label key={rule.id} className="rule-option"><input type="checkbox" checked={selectedRules.includes(rule.text)} onChange={() => setSelectedRules(current => current.includes(rule.text) ? current.filter(text => text !== rule.text) : current.length >= 30 ? current : [...current, rule.text])}/><span>{rule.text}{rule.recommended && <small>Suggested</small>}</span></label>)}</div><div className="custom-rule-editor"><label htmlFor="custom-hunt-rule">Add your own rule</label><div><input id="custom-hunt-rule" maxLength={1000} value={customRuleDraft} onChange={event => setCustomRuleDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addCustomRule() } }} placeholder="Add a rule for this hunt"/><button type="button" className="outline-button" disabled={!customRuleDraft.trim() || selectedRules.length >= 30} onClick={addCustomRule}><Plus size={14}/> Add rule</button></div><small>Up to 30 rules, 1,000 characters each.</small></div>{selectedRules.filter(rule => !SUGGESTED_RULES.some(suggested => suggested.text === rule)).length > 0 && <ul className="custom-rule-list" aria-label="Custom rules">{selectedRules.filter(rule => !SUGGESTED_RULES.some(suggested => suggested.text === rule)).map(rule => <li key={rule}><span>{rule}</span><button type="button" aria-label={`Remove rule: ${rule}`} onClick={() => setSelectedRules(current => current.filter(existing => existing !== rule))}><X size={14}/></button></li>)}</ul>}</>}</div></section>
          <section className={`builder-section ${venue.trim() ? '' : 'builder-locked'}`}><div className="builder-step">3</div><div className="builder-main"><div className="builder-items-heading"><div><h2>Build the photo list</h2><p>Add the items participants need to find and photograph.</p></div>{venue.trim() && <button type="button" className="outline-button" onClick={addDraftItem}><Plus size={15}/> Add item</button>}</div>{!venue.trim() ? <div className="locked-note"><ClipboardList size={15}/> Enter a venue above to start your list.</div> : draftItems.length === 0 ? <div className="item-prompt"><span><Camera size={19}/></span><div><b>Your hunt needs at least one photo challenge</b><p>Choose recognizable things participants can find at this venue.</p></div><button type="button" className="outline-button" onClick={addDraftItem}><Plus size={15}/> Add first item</button></div> : <ChallengeListEditor items={draftItems.map(item => ({ id: item.key, title: item.title, description: item.description, points: item.pointValue }))} variant="production" onChange={updateDraftChallengeList}/>}<details className="production-challenge-import"><summary>Paste a challenge list</summary><p>One challenge per line. You can review and edit every imported item before saving.</p><label className="editor-label">Challenge list<textarea rows={5} value={challengePaste} onChange={event => setChallengePaste(event.target.value)} placeholder="Find something red, then a team selfie"/></label><label className="import-option"><input type="checkbox" checked={stripListMarkers} onChange={event => setStripListMarkers(event.target.checked)}/> Remove leading list bullets and numbering</label><button type="button" className="outline-button" onClick={importDraftChallenges}>Import and edit challenges</button></details>{venue.trim() && selectableLibraryItems.length > 0 && <div className="library-picker"><div><b>From your challenge library</b><span>Saved ideas can be reused in any hunt.</span></div><label className="library-picker-search">Search saved challenges<input type="search" value={libraryPickerSearch} onChange={event => setLibraryPickerSearch(event.target.value)} placeholder="Search by name or clue" /></label>{libraryAddedMessage && <p role="status">{libraryAddedMessage}</p>}<div className="library-picker-list">{filteredLibraryItems.map(item => <button type="button" className="library-picker-item" key={item.id} onClick={() => addLibraryChallenge(item)}><span><b>{item.title}</b><small>{item.category || item.description || 'Reusable challenge'}</small></span><Plus size={15}/></button>)}</div>{filteredLibraryItems.length === 0 && <p className="locked-note">No saved challenges match this search.</p>}</div>}</div></section>
          {huntMessage && <div className="form-error" role="alert">{huntMessage}</div>}
          <div className="builder-actions"><button type="button" className="outline-button" onClick={() => {setEditingDraftId(''); setPage('hunts')}}>Cancel</button><button type="submit" className="primary-button save-hunt-button" disabled={huntSaving || !venue.trim() || !draftItems.some(item => item.title.trim())}>{huntSaving ? 'Saving hunt…' : <><Check size={16}/> {editingDraftId ? 'Save draft changes' : 'Save draft hunt'}</>}</button></div>
        </form>
      </section> : page === 'hunts' ? <section className="workspace-content hunts-content">
        <div className="library-title-row"><div><div className="eyebrow"><ClipboardList size={14}/> YOUR ADVENTURES</div><h1>Your hunts</h1><p>Pick up a draft, start a waiting hunt, or manage a live game.</p></div><button className="primary-button library-add" onClick={() => { setPage('new-hunt'); setHuntMessage('') }}><Plus size={17}/> Create a hunt</button></div>
        {loadError && <div className="inline-alert">{loadError}</div>}
        {huntMessage && <div className="inline-alert" role="alert">{huntMessage}</div>}
        {unfinishedHunts.length ? <div className="hunt-list">{unfinishedHunts.map(renderHuntCard)}</div> : completedHunts.length ? <div className="empty-library"><span className="empty-icon"><Check size={24}/></span><b>No hunts need attention</b><p>Your completed results are filed under Past results.</p></div> : <div className="empty-library"><span className="empty-icon"><MapPin size={24}/></span><b>No hunts yet</b><p>Pick a venue and create a photo list to start planning.</p><button className="outline-button" onClick={() => setPage('new-hunt')}><Plus size={15}/> Create your first hunt</button></div>}
        {completedHunts.length > 0 && <details className="organizer-history-disclosure"><summary>Past results ({completedHunts.length})</summary><div className="hunt-list">{completedHunts.map(renderHuntCard)}</div></details>}
      </section> : page === 'account' ? <section className="workspace-content account-settings-content">
        <button className="back-link" onClick={() => setPage('hunts')}><ArrowLeft size={15}/> Back to My hunts</button>
        <div className="new-hunt-heading"><div className="eyebrow"><Settings2 size={14}/> ACCOUNT</div><h1>Account settings</h1><p>Manage the name other players see and your private sign-in details.</p></div>
        {accountError && <div className="form-error" role="alert">{accountError}</div>}{accountMessage && <div className="inline-alert" role="status">{accountMessage}</div>}
        <section className="account-setting-card"><div><h2>Display name</h2><p>Players see this name in hunt chat and as the author of templates you publish. Your email stays private.</p></div><form onSubmit={saveCreatorDisplayName}><label className="builder-field">Name other players see<input autoComplete="nickname" maxLength={80} required value={displayNameDraft} onChange={event => setDisplayNameDraft(event.target.value)} placeholder="Your display name"/></label><button type="submit" className="primary-button" disabled={accountBusy}>{accountBusy ? 'Saving...' : 'Save display name'}</button></form></section>
        <section className="account-setting-card"><div><h2>Sign-in email</h2><p>This address is used to sign in. Only you can see it in Account settings.</p></div><p className="private-account-email">{session.user.email || 'No email address on this account'}</p></section>
        <section className="account-setting-card"><div><h2>Password</h2><p>Choose a password with at least 8 characters. You can update it here after signing in with a recovery link.</p></div><form onSubmit={saveAccountPassword}><label className="builder-field">New password<input type="password" autoComplete="new-password" minLength={8} required value={newPassword} onChange={event => setNewPassword(event.target.value)}/></label><label className="builder-field">Confirm new password<input type="password" autoComplete="new-password" minLength={8} required value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)}/></label><button type="submit" className="primary-button" disabled={accountBusy}>{accountBusy ? 'Saving...' : 'Update password'}</button></form></section>
      </section> : page === 'manage-hunt' && managedHunt ? <section className="workspace-content new-hunt-content manage-hunt-content">
        <button className="back-link" onClick={() => setPage('hunts')}><ArrowLeft size={15}/> Back to your hunts</button>
        <div className="new-hunt-heading"><div className="eyebrow"><Settings2 size={14}/> HUNT MANAGEMENT</div><h1>{managedHunt.title}</h1><p><MapPin size={14}/> {managedHunt.venue} <span className="manage-divider">·</span> {managedHunt.duration_minutes} minute time limit</p></div>
        <section className="hunt-stage-summary" aria-label="Hunt status">{stageIndex !== undefined && <><strong className="hunt-stage-summary-current">{huntStatusLabel(managedHunt.status)} | Step {stageIndex + 1} of 5</strong><details className="hunt-stage-details" open={!mobileLayout}><summary>See all hunt stages</summary><ol className="hunt-stage-list" aria-label="Hunt progress">{['Setup', 'Waiting', 'Playing', 'Review', 'Results'].map((label, index) => { const progress = index < stageIndex ? 'complete' : index === stageIndex ? 'current' : 'upcoming'; const direction = index < stageIndex ? 'DONE' : index === stageIndex ? 'YOU ARE HERE' : index === stageIndex + 1 ? 'NEXT' : 'LATER'; return <li key={label} aria-current={index === stageIndex ? 'step' : undefined} className={`hunt-stage-step ${progress}`}><span className="hunt-stage-marker">{index < stageIndex ? <Check size={13}/> : index + 1}</span><span className="hunt-stage-copy"><span className="hunt-stage-label">{label}</span><span className="hunt-stage-direction">{direction}</span></span></li>})}</ol></details></>}<div><span>Current status</span><strong>{huntStatusLabel(managedHunt.status)}</strong></div>{lobbyStatusStale && <p role="status">Hunt status may be out of date. <button type="button" className="outline-button" onClick={() => void loadManagedLobby(managedHunt.id)}>Retry</button></p>}{managedHunt.status !== 'draft' && <p>{managedParticipants.length} {managedParticipants.length === 1 ? 'player' : 'players'} joined across {managedTeams.length} {managedTeams.length === 1 ? 'team' : 'teams'}.</p>}{managedHunt.status === 'scheduled' && managedHunt.start_at && <p>Scheduled for {new Date(managedHunt.start_at).toLocaleString()}.</p>}{['ended', 'review', 'completed'].includes(managedHunt.status) && <button className="primary-button hunt-stage-action" type="button" onClick={() => setPage('review-hunt')}>{huntActionLabel(managedHunt.status)}</button>}</section>
        {managedHunt.status !== 'draft' && <section id="team-invitations" className="lobby-invitations-section" aria-label="Team invitations">
          {inviteRecoveryError && <p className="form-error" role="alert">{inviteRecoveryError}</p>}
          {inviteWindowOpen && inviteCodes.length > 0 ? <InviteLinksPanel invites={inviteCodes} inviteUrl={inviteUrl} copiedInvite={copiedInvite} assignmentMode={managedHunt.team_assignment_mode} busy={manageSaving || inviteRecoveryLoading} canReplace={!inviteRecoveryError && !inviteRecoveryIncomplete && inviteWindowOpen} onCopy={token => void copyInvite(token)} onTest={testInvite} onJoinTeam={token => void joinTeam(token)} onSeePlayers={() => openManagementSection('team-roster')} onReplaceCodes={() => void regenerateInvites()} onPrint={() => window.print()} /> : <div className="locked-note"><ShieldCheck size={15}/>{inviteRecoveryLoading ? 'Loading saved team invitation links.' : inviteRecoveryIncomplete ? inviteWindowOpen ? 'Existing invitation links are active but could not be restored on this device.' : 'This hunt has ended, so invitation links are closed.' : inviteWindowOpen && hasActiveInvites ? 'Invitation links are active, but their recovery details are unavailable.' : inviteWindowOpen ? 'No active links yet. Create team invitations to display QR codes.' : 'This hunt has ended, so invitation links are closed.'}</div>}
          {inviteWindowOpen && !inviteCodes.length && inviteRecoveryLoading && <p className="invite-recovery-status" role="status">Checking for saved team codes.</p>}
          {inviteWindowOpen && !inviteCodes.length && (inviteRecoveryError || inviteRecoveryIncomplete) && <button type="button" className="outline-button" onClick={() => void loadManagedLobby(managedHunt.id)}>Retry loading team codes</button>}
          {inviteWindowOpen && !inviteCodes.length && inviteRecoveryIncomplete && hasActiveInvites && <div className="invite-recovery-actions"><p>Replacing the team codes will invalidate every older QR code and link.</p><button type="button" className="outline-button" disabled={manageSaving} onClick={() => void regenerateInvites()}><QrCode size={15}/> Replace team codes</button></div>}
          {inviteWindowOpen && !inviteCodes.length && !inviteRecoveryLoading && !inviteRecoveryError && !inviteRecoveryIncomplete && <button type="button" className="outline-button" disabled={manageSaving} onClick={() => void regenerateInvites()}><QrCode size={15}/>{hasActiveInvites ? ' Replace team codes' : ' Create team codes'}</button>}
        </section>}
        {managedHunt.status !== 'draft' && <nav className="hunt-section-nav" aria-label="Hunt sections"><button type="button" className="outline-button" onClick={() => openManagementSection('team-invitations')}>Teams & invitations</button><button type="button" className="outline-button" onClick={() => openManagementSection('team-roster')}>Team roster</button><button type="button" className="outline-button" onClick={() => openManagementSection('organizer-chat')}>Hunt chat</button><button type="button" className="outline-button" onClick={() => openManagementSection('organizer-troubleshooting')}>Troubleshooting</button></nav>}
         {manageMessage && <div className="form-error" role="alert">{manageMessage}</div>}
         {managedHunt.status === 'scheduled' && <section className="builder-section organizer-hunt-controls" aria-label="Hunt controls"><div className="builder-step"><Play size={15}/></div><div className="builder-main"><div className="eyebrow">GAME CONTROLS</div><h2>Ready to start?</h2><p>Start when your teams are ready. Their invitations and team assignments stay the same.</p><div className="celebration-card-actions"><button type="button" className="primary-button" disabled={manageSaving} onClick={() => void startHuntNow()}><Play size={15}/>{managedHunt.start_at && new Date(managedHunt.start_at).getTime() > Date.now() ? ' Start early' : ' Start hunt now'}</button></div><details className="hunt-end-options"><summary>More hunt controls</summary><p>End this hunt early and move to photo review.</p><button className="reject-button end-hunt-button" disabled={manageSaving} onClick={() => void endHuntNow()}><Clock3 size={14}/> End hunt now and review</button></details></div></section>}
        {managedHunt.status === 'scheduled' && managedHunt.start_at && new Date(managedHunt.start_at).getTime() > Date.now() && <section className="builder-section"><div className="builder-step"><CalendarDays size={15}/></div><div className="builder-main"><h2>Change scheduled time</h2><label className="builder-field">New start time<input type="datetime-local" value={startAtLocal} onChange={event => setStartAtLocal(event.target.value)}/></label><button className="outline-button" disabled={timingBusy} onClick={() => void rescheduleHunt()}>{timingBusy ? 'Saving…' : 'Save new time'}</button></div></section>}
         {managedHunt.status === 'active' && <section className="builder-section organizer-hunt-controls" aria-label="Hunt controls"><div className="builder-step"><Clock3 size={15}/></div><div className="builder-main"><div className="eyebrow">GAME CONTROLS</div><h2>Hunt in progress</h2><p>Add time before the current timer ends.</p><div className="celebration-card-actions"><button className="outline-button" disabled={timingBusy} onClick={() => void addHuntTime(15)}>Add 15 minutes</button><button className="outline-button" disabled={timingBusy} onClick={() => void addHuntTime(30)}>Add 30 minutes</button><button className="reject-button end-hunt-button" disabled={manageSaving} onClick={() => void endHuntNow()}><Clock3 size={14}/> End hunt now and review</button></div></div></section>}
         {managedHunt.status !== 'draft' && <><div id="organizer-chat"><HuntChat huntId={managedHunt.id} compact app="organizer_web" readOnly={!['scheduled','active'].includes(managedHunt.status)} /></div><details className="organizer-section-disclosure" id="team-roster"><summary>Teams, members, and selfies</summary><TeamLobby teams={managedTeams} participants={managedParticipants} onRefresh={() => void loadManagedLobby(managedHunt.id)} /></details><details className="organizer-section-disclosure" id="organizer-troubleshooting"><summary>Troubleshooting</summary><HuntDiagnostics huntId={managedHunt.id} /></details></>}
        {managedHunt.status === 'draft' ? <form className="hunt-builder" onSubmit={publishHunt}>
          <section className="builder-section"><div className="builder-step"><CalendarDays size={15}/></div><div className="builder-main"><h2>Choose when and how to play</h2><p>Set up the lobby now, then start the timer when your teams are ready.</p><div className="start-mode-options" role="group" aria-label="Hunt start mode"><label className={`start-mode-option ${startMode === 'manual' ? 'selected' : ''}`}><input type="radio" name="start-mode" checked={startMode === 'manual'} onChange={() => setStartMode('manual')}/><span><b>Start manually</b><small>Teams join a waiting lobby. You start the hunt when everyone is ready.</small></span></label><label className={`start-mode-option ${startMode === 'scheduled' ? 'selected' : ''}`}><input type="radio" name="start-mode" checked={startMode === 'scheduled'} onChange={() => setStartMode('scheduled')}/><span><b>Schedule a start</b><small>The server starts the hunt automatically at the selected time.</small></span></label></div>{startMode === 'scheduled' && <label className="builder-field">Scheduled start time<input type="datetime-local" required value={startAtLocal} onChange={event => setStartAtLocal(event.target.value)}/><span className="optional">Shown in your local time zone; saved as UTC. You can still start early.</span></label>}<label className="builder-field">Team assignment method<select value={assignmentMode} onChange={event => setAssignmentMode(event.target.value as 'organizer' | 'balanced')}><option value="organizer">Participants scan their assigned team's code</option><option value="balanced">One shared code assigns balanced teams</option></select></label><label className="builder-field">Team names <span className="optional">One name per line · 2–12 teams</span><textarea rows={Math.min(8, Math.max(3, teamNamesText.split('\n').length))} maxLength={600} value={teamNamesText} onChange={event => setTeamNamesText(event.target.value)} placeholder={'Team Red\nTeam Blue'} /></label><label className="voting-config"><input type="checkbox" checked={votingEnabled} onChange={event => setVotingEnabled(event.target.checked)}/><span><b>Enable photo voting during review</b><small>Teams can vote for another team's approved photos.</small></span></label>{votingEnabled && <label className="builder-field duration-field">Voting bonus points<input type="number" min={0} max={1000} value={votingBonusPoints} onChange={event => setVotingBonusPoints(Math.max(0, Number(event.target.value)))}/></label>}</div></section>
          <div className="builder-actions"><button type="button" className="outline-button" onClick={() => setPage('hunts')}>Cancel</button><button type="submit" className="primary-button save-hunt-button" disabled={manageSaving}>{manageSaving ? 'Publishing…' : <><QrCode size={16}/> Publish & create QR codes</>}</button></div>
        </form> : <>
          <section className="builder-section"><div className="builder-step"><Users size={15}/></div><div className="builder-main"><h2>Participants</h2><p>{managedParticipants.length} {managedParticipants.length === 1 ? 'person has' : 'people have'} joined this hunt. You can move participants before the scheduled start.</p>{managedParticipants.length ? <div className="participant-roster">{managedParticipants.map(participant => <div className="participant-roster-row" key={participant.id}><span className="participant-avatar"><UserRound size={15}/></span><b>{participant.display_name}</b><select aria-label={`Team for ${participant.display_name}`} value={participant.team_id} onChange={event => void moveParticipant(participant, event.target.value)} disabled={managedHunt.status !== 'scheduled'}>{managedTeams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></div>)}</div> : <div className="locked-note"><Users size={15}/> The roster fills in as participants join from their invitation links.</div>}</div></section>
        </>}
      </section> : page === 'review-hunt' && managedHunt ? <HuntReview huntId={managedHunt.id} title={managedHunt.title} status={managedHunt.status} onBack={() => setPage('hunts')} onChanged={() => void loadWorkspace()} /> : null}
    </main>
    {pendingPage && <ConfirmDialog title="Discard this hunt draft?" message="Your unsaved venue, rules, and photo challenges will be cleared." cancelLabel="Keep editing" confirmLabel="Discard changes" destructive onCancel={() => setPendingPage(null)} onConfirm={discardDraftAndNavigate}/>}
  </div>
}
