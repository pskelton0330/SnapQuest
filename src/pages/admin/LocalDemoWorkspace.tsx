import { useEffect, useState } from 'react'
import { ArrowLeft, ShieldCheck, Plus, ClipboardList } from 'lucide-react'
import GameManager from '../../components/GameManager'
import { gameRuntime, type SetupIntent } from '../../lib/gameManagement'
import HuntEditor from '../../components/HuntEditor'
import HuntDiscovery from '../../components/HuntDiscovery'
import { completedPlayCounts } from '../../lib/huntEditor'
import WorkspaceNavigation from '../../components/WorkspaceNavigation'
import { GameCard } from '../../components/WorkspaceCards'
import { createLocalWorkspaceRepository, LOCAL_CREATOR, parseWorkspaceRoute, type WorkspaceData, type GameStatus, type HuntTemplate } from '../../lib/workspace'

const labels = { browse: 'Browse Hunts', hunts: 'My Hunts', games: 'My Games', create: 'Create a Hunt' }
export default function LocalDemoWorkspace({ routeHash }: { routeHash: string }) {
  const [repository] = useState(() => createLocalWorkspaceRepository(localStorage))
  const [data, setData] = useState<WorkspaceData | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [now, setNow] = useState(Date.now)
  const [filter, setFilter] = useState<GameStatus | 'all'>('all')
  const route = parseWorkspaceRoute(routeHash)

  useEffect(() => {
    let cancelled = false
    const refresh = () => { void repository.load().then(value => { if (!cancelled) { setData(value); setNow(Date.now()) } }).catch(err => { if (!cancelled) setError(String(err.message)) }) }
    refresh()
    const timer = setInterval(refresh, 2000)
    window.addEventListener('storage', refresh)
    return () => { cancelled = true; clearInterval(timer); window.removeEventListener('storage', refresh) }
  }, [repository])

  async function saveHunt(hunt: HuntTemplate) {
    const saved = await repository.saveHunt(hunt)
    setData(await repository.load())
    return saved
  }

  async function createGame(id: string, intent: SetupIntent = 'schedule') {
    setSaving(true); setError('')
    try {
      const game = await repository.createGame(id, crypto.randomUUID(), new Date().toISOString(), intent)
      setData(await repository.load()); window.location.hash = `/dev/games/${game.id}`
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not create a preview game.') }
    finally { setSaving(false) }
  }

  async function customizeHunt(id: string) {
    setSaving(true); setError('')
    try {
      const copy = await repository.copyHunt(id, crypto.randomUUID(), new Date().toISOString())
      setData(await repository.load()); window.location.hash = `/dev/create/${copy.id}`
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not create a personal copy.') }
    finally { setSaving(false) }
  }

  const hunt = route.id && route.page !== 'games' && route.page !== 'create' ? data?.hunts.find(h => h.id === route.id && (route.page !== 'hunts' || h.creatorId === LOCAL_CREATOR)) : undefined
  const game = route.page === 'games' && route.id ? data?.games.find(g => g.id === route.id) : undefined
  const editing = route.page === 'create' && route.id ? data?.hunts.find(h => h.id === route.id && h.creatorId === LOCAL_CREATOR) : undefined
  const listedGames = data?.games.map(g => { const state = gameRuntime(g, now); return { ...g, status: (state === 'ended' ? 'review' : state) as GameStatus } }) ?? []
  const missing = data && route.id && !hunt && !game && !editing

  return <div className="workspace local-demo-workspace">
    <WorkspaceNavigation route={route}/>
    <main className="workspace-main">
      <header className="workspace-topbar"><div className="breadcrumb"><a href="#">Home</a> <span>/</span> {labels[route.page]}</div><div className="local-demo-badge"><ShieldCheck size={15}/> Local preview</div></header>
      <section className="workspace-content local-demo-content">
        <div className="local-demo-banner"><strong>Development preview · sample data</strong><span>Hunts and games here stay in this browser. Sample public hunts do not represent a live community library. Your Supabase data is separate.</span></div>
        {error && <div className="v12-error" role="alert">{error}</div>}
        {!data ? <p role="status">{error ? 'Preview data is unavailable.' : 'Opening your workspace…'}</p> : missing ? <div className="v12-empty"><h1>This {route.page === 'games' ? 'game' : 'hunt'} was not found</h1><a className="outline-button" href={`#/dev/${route.page}`}>Return to {labels[route.page]}</a></div> : hunt ? <>
          <a className="back-link" href={`#/dev/${route.page}`}><ArrowLeft size={15}/> {labels[route.page]}</a>
          <div className="workspace-greeting"><div><div className="eyebrow">REUSABLE HUNT</div><h1>{hunt.title}</h1><p>{hunt.venue} · Created by {hunt.creatorName}</p></div></div>
          <div className="v12-detail-grid"><section className="v12-card"><h2>About this hunt</h2><p>{hunt.description || 'No description yet.'}</p><p>{hunt.challenges.length} challenges · {hunt.defaultDuration} minutes by default</p><p>{completedPlayCounts(data.games).get(hunt.id) ?? 0} completed preview games</p><h3>Ground rules</h3><ul>{hunt.rules.map((rule, i) => <li key={i}>{rule}</li>)}</ul><button className="primary-button" disabled={saving} onClick={() => void createGame(hunt.id)}><Plus size={16}/> {saving ? 'Creating…' : 'Create Game'}</button><button className="outline-button" disabled={saving} onClick={() => void customizeHunt(hunt.id)}>Customize Hunt · personal copy</button>{hunt.creatorId === LOCAL_CREATOR && <a className="outline-button" href={`#/dev/create/${hunt.id}`}>Edit Hunt</a>}<p className="v12-muted">Create a game, then configure its lobby and start time. Selecting a hunt does not start the countdown. Settings apply to this game only.</p></section><section className="v12-card"><h2>Photo challenges</h2><ol>{hunt.challenges.map(c => <li key={c.id}>{c.title} <small>· {c.points} {c.points === 1 ? 'point' : 'points'}</small></li>)}</ol></section></div>
        </> : game ? <GameManager key={game.id} game={game} repository={repository} onChanged={async () => setData(await repository.load())}/> : route.page === 'create' ? <HuntEditor key={route.id ?? 'new'} initial={editing} ideas={data.hunts.flatMap(h => h.challenges)} onSave={saveHunt} onGame={createGame}/> : <>
          <div className="workspace-greeting"><div><div className="eyebrow">{route.page === 'games' ? 'YOUR GAME NIGHT' : 'FIND YOUR NEXT ADVENTURE'}</div><h1>{labels[route.page]}</h1><p>{route.page === 'browse' ? 'Explore sample hunts and create a separate game from any hunt.' : route.page === 'hunts' ? 'Your reusable templates and imported local drafts.' : 'Each game has its own setup, participants and results.'}</p></div><a className="outline-button" href="#/dev/create"><Plus size={16}/> Create a Hunt</a></div>
          {route.page === 'games' && <div className="v12-filters" role="group" aria-label="Filter games">{(['all','setup','scheduled','active','review','completed'] as const).map(status => <button type="button" key={status} aria-pressed={filter === status} onClick={() => setFilter(status)}>{status === 'all' ? 'All games' : status === 'review' ? 'Awaiting review' : status}</button>)}</div>}
          {route.page === 'games' ? <><div className="v12-card-grid">{listedGames.filter(g => filter === 'all' || g.status === filter).map(g => <GameCard key={g.id} game={g}/>)}</div>{!listedGames.some(g => filter === 'all' || g.status === filter) && <div className="v12-empty"><ClipboardList size={25}/><h2>Nothing here yet</h2><p>Choose a hunt to set up a game, or try another filter.</p></div>}</> : <HuntDiscovery key={route.page} page={route.page === 'browse' ? 'browse' : 'hunts'} hunts={data.hunts.filter(h => route.page === 'browse' ? h.visibility === 'public' : h.creatorId === LOCAL_CREATOR)} games={data.games}/>}
        </>}
      </section>
    </main>
  </div>
}
