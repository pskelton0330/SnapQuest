import { useCallback, useEffect, useState, type FormEvent } from 'react'

import ConfirmDialog from './ConfirmDialog'

import { QRCodeSVG } from 'qrcode.react'

import { ArrowLeft, Clock3, Users, QrCode, Plus } from 'lucide-react'

import { countdown, gameDeadline, gameRuntime, type GameCommand } from '../lib/gameManagement'

import { createLocalWorkspaceRepository, type Game, type GameManagementRepository } from '../lib/workspace'



function localTime(iso?: string | null) {

  const date = new Date(iso ?? Date.now() + 3600000)

  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0,16)

}

function useClock() {

  const [now,setNow] = useState(Date.now)

  useEffect(() => { const timer = setInterval(() => setNow(Date.now()),1000); return () => clearInterval(timer) },[])

  return now

}

export default function GameManager({ game, repository, onChanged }: { game: Game; repository: GameManagementRepository; onChanged: () => Promise<void> }) {

  const localNow=useClock(), now=localNow+(game.clockOffsetMs??0), state=gameRuntime(game,now)

  const [name,setName]=useState(game.name), [duration,setDuration]=useState(game.duration)

  const [teamNames,setTeamNames]=useState('Team Red\nTeam Blue'), [assignment,setAssignment]=useState<'organizer'|'balanced'>('organizer')

  const [startAt,setStartAt]=useState(localTime(game.startAt)), [immediate,setImmediate]=useState(game.setupIntent==='now')

  const [voting,setVoting]=useState(false), [bonus,setBonus]=useState(0)

  const [extension,setExtension]=useState(5), [busy,setBusy]=useState(false), [error,setError]=useState(''), [notice,setNotice]=useState('')

  const [confirmation,setConfirmation]=useState<{message:string;action:()=>void}|null>(null)

  const closeConfirmation=useCallback(()=>setConfirmation(null),[setConfirmation])

  async function run(action: () => Promise<unknown>) {

    setBusy(true); setError('');setNotice('')

    try { await action(); await onChanged() } catch(err) { setError(err instanceof Error ? err.message : 'Could not update this game.') }

    finally { setBusy(false) }

  }

  function command(change: GameCommand) { void run(() => repository.commandGame(game.id,change)) }

  function configure(event: FormEvent) {

    event.preventDefault()

    const apply=()=>void run(() => repository.configureGame(game.id,{ name,duration,teamNames:teamNames.split('\n').map(n=>n.trim()).filter(Boolean),assignment,startAt:immediate ? new Date().toISOString() : new Date(startAt).toISOString(),startNow:immediate,voting,bonus }))

    if(immediate)setConfirmation({message:'Save this setup and start gameplay immediately?',action:apply})

    else apply()

  }

  const teams=game.teams??[], players=game.players??[]

  const stage = state === 'scheduled' ? 'Lobby' : state === 'ended' ? 'Review' : state[0].toUpperCase() + state.slice(1)

  const guidance = state === 'setup' ? 'Choose teams, duration, and a start time. No game time is being used yet.' : state === 'scheduled' ? 'Invite your players and check the roster. The game starts automatically at the scheduled time, or you can confirm Start Now.' : state === 'active' ? 'The countdown is running. Timing controls and team registrations are together below.' : state === 'completed' ? 'This game is complete. Its challenge snapshot is preserved.' : 'Gameplay has ended. Photo judging and results are available in the existing Supabase workspace; this local preview does not simulate them.'

  return <>

    <a className="back-link" href="#/dev/games"><ArrowLeft size={15}/> My Games</a>

    <div className="workspace-greeting"><div><div className="eyebrow">GAME MANAGEMENT</div><h1>{game.name}</h1><p>Hunt: {game.huntSnapshot.title} · {game.huntSnapshot.venue}</p></div><span className="v12-tag">{stage}</span></div><nav className="game-stages" aria-label="Game lifecycle"><ol>{['Setup','Lobby','Active','Review','Completed'].map(label=><li key={label} aria-current={label===stage?'step':undefined}>{label}</li>)}</ol></nav><section className="v12-card game-guidance"><h2>{stage === 'Setup' ? 'Get your game ready' : stage === 'Lobby' ? 'Welcome your players' : stage === 'Active' ? 'Manage active play' : stage === 'Review' ? 'Ready for review' : 'Game complete'}</h2><p>{guidance}</p>{state!=='setup'&&<div className="editor-actions"><button className="outline-button" onClick={()=>document.getElementById('game-timing')?.scrollIntoView()}>Timing & controls</button><button className="outline-button" onClick={()=>document.getElementById('game-teams')?.scrollIntoView()}>Teams & players</button>{['scheduled','active'].includes(state)&&<button className="outline-button" onClick={()=>document.getElementById('game-invitations')?.scrollIntoView()}>Invitations</button>}</div>}</section>

    {error && <div className="v12-error" role="alert">{error}</div>}{notice&&<p role="status">{notice}</p>}

    {state==='setup' ? <form className="v12-card game-setup" onSubmit={configure}><h2>Set up your game</h2><div className="editor-fields"><label>Game name<input required maxLength={120} value={name} onChange={e=>setName(e.target.value)}/></label><label>Duration (minutes)<input type="number" min={5} max={1440} required value={duration} onChange={e=>setDuration(Number(e.target.value))}/></label><label>When to start<select value={immediate?'now':'schedule'} onChange={e=>setImmediate(e.target.value==='now')}><option value="schedule">Schedule and open the lobby</option><option value="now">Start as soon as setup is saved</option></select></label>{!immediate&&<label>Scheduled start<input type="datetime-local" required value={startAt} onInput={e=>setStartAt(e.currentTarget.value)}/></label>}<label>Number of teams<select value={teamNames.split('\n').length} onChange={e=>{const n=Number(e.target.value),current=teamNames.split('\n');setTeamNames(Array.from({length:n},(_,i)=>current[i]??`Team ${i+1}`).join('\n'))}}>{Array.from({length:11},(_,i)=><option value={i+2} key={i}>{i+2} teams</option>)}</select></label><label>Team assignment<select value={assignment} onChange={e=>setAssignment(e.target.value as 'organizer'|'balanced')}><option value="organizer">Individual QR code for each team</option><option value="balanced">One shared code · balanced random assignment</option></select></label><label className="editor-wide">Team names · one per line<textarea rows={4} maxLength={600} value={teamNames} onChange={e=>setTeamNames(e.target.value)}/></label><label>Photo voting<select value={voting?'yes':'no'} onChange={e=>setVoting(e.target.value==='yes')}><option value="no">Disabled</option><option value="yes">Enable during review</option></select></label>{voting&&<label>Voting bonus<input type="number" min={0} max={1000} value={bonus} onChange={e=>setBonus(Number(e.target.value))}/></label>}</div><p>Rules and {game.huntSnapshot.challenges.length} challenges are copied from this hunt. This game’s duration and teams are independent.</p><button className="primary-button" disabled={busy} type="submit">{busy?'Saving…':immediate?'Save setup & start now':'Save setup & open lobby'}</button></form> : <>

      <section className="game-lobby-summary"><div className="v12-card"><Clock3 size={24}/><h2>{state==='scheduled'?'Game starts in':state==='active'?'Time remaining':'Game finished'}</h2><div className="lobby-countdown" role="timer">{countdown(state==='scheduled'?Date.parse(game.startAt??'')-now:state==='active'?gameDeadline(game)-now:0)}</div><p>Start: {game.startAt?new Date(game.startAt).toLocaleString():'Not set'}</p><p>Deadline: {Number.isFinite(gameDeadline(game))?new Date(gameDeadline(game)).toLocaleString():'Not set'} · {game.duration} min</p></div><div className="v12-card"><Users size={24}/><h2>{players.length} registered {players.length===1?'player':'players'}</h2><p>{teams.length} teams · {game.assignment==='balanced'?'Balanced random assignment':'Assigned-team invitations'}</p><p>{game.voting?`Voting enabled · ${game.votingBonus??0} bonus points`:'Voting disabled'}</p><p className="v12-muted">Preview registration and links work only in this browser’s local data. Real participant accounts and private photo uploads stay in the existing Supabase flow.</p></div></section>

      <section id="game-timing" className="v12-card game-controls"><h2>Game controls</h2><div className="editor-actions">{state==='scheduled'&&<button className="primary-button" disabled={busy} onClick={()=>{setConfirmation({message:'Start this game now? Waiting players will enter gameplay immediately.',action:()=>command({type:'start'})})}}>Start Now</button>}{state==='active'&&<>{[5,10,15].map(minutes=><button className="outline-button" key={minutes} disabled={busy} onClick={()=>command({type:'extend',minutes})}><Plus size={14}/> {minutes} min</button>)}<label>Custom minutes<input type="number" min={1} max={120} value={extension} onChange={e=>setExtension(Number(e.target.value))}/></label><button className="outline-button" disabled={busy} onClick={()=>command({type:'extend',minutes:extension})}>Add time</button></>}{['scheduled','active','ended'].includes(state)&&<button className="outline-button" disabled={busy} onClick={()=>{setConfirmation({message:state==='ended'?'Move this game into photo review?':'End this game now and close photo submissions?',action:()=>command({type:'end'})})}}>{state==='ended'?'Begin review':'End Early'}</button>}</div>{state==='scheduled'&&<form className="game-reschedule" onSubmit={event=>{event.preventDefault();void run(()=>repository.commandGame(game.id,{type:'reschedule',startAt:new Date(startAt).toISOString()}))}}><label>New scheduled start<input type="datetime-local" required value={startAt} onInput={e=>setStartAt(e.currentTarget.value)}/></label><button className="outline-button" disabled={busy}>Reschedule Game</button></form>}{['review','completed'].includes(state)&&<p>{state==='completed'?'This sample is completed.':'Ready for photo review.'} The existing Supabase review and results screens are retained; local demo photos and scores are not generated here.</p>}</section>

      <section id="game-teams" className="v12-card"><div className="editor-section-heading"><div><h2>Team lobby</h2><p>{players.length} total registered players</p></div>{['scheduled','active'].includes(state)&&<button className="outline-button" disabled={busy} onClick={()=>{setConfirmation({message:'Replace invitation links? Previous links will stop working; joined players keep their teams.',action:()=>command({type:'rotate'})})}}><QrCode size={16}/> Replace invitations</button>}</div><div className="lobby-teams">{teams.map(team=><article className="lobby-team" key={team.id}><h3><span style={{background:team.color}}/>{team.name} <small>{players.filter(p=>p.teamId===team.id).length} players</small></h3><ul>{players.filter(p=>p.teamId===team.id).map(player=><li key={player.id}>{player.name}</li>)}</ul>{!players.some(p=>p.teamId===team.id)&&<p>No players yet</p>}</article>)}</div>{!teams.length&&<p>This legacy sample has no configured teams.</p>}</section>

      {['scheduled','active'].includes(state)&&<section id="game-invitations" className="v12-card"><h2>Preview QR invitations</h2><p>Open a link to simulate player registration. A phone on another device cannot access this browser’s local preview data.</p><div className="lobby-invites">{(game.invites??[]).map(invite=>{const url=`${window.location.origin}${window.location.pathname}#/dev/player/${game.id}/${invite.token}`;return <article key={invite.token}><h3>{invite.teamId?teams.find(t=>t.id===invite.teamId)?.name:'Shared balanced invitation'}</h3><QRCodeSVG value={url} size={140} marginSize={2}/><a className="outline-button" href={url}>Open player preview</a><button className="outline-button" onClick={()=>{void (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject(new Error('Clipboard unavailable'))).then(()=>setNotice('Preview invitation copied.')).catch(()=>setError('Clipboard unavailable. Open the player preview and copy its address.'))}}>Copy link</button></article>})}</div></section>}

    </>}

    {confirmation&&<ConfirmDialog message={confirmation.message} onCancel={closeConfirmation} onConfirm={()=>{closeConfirmation();confirmation.action()}}/>}

  </>

}



export function LocalPlayerPreview({ gameId, token }: { gameId: string; token: string }) {

  const [repository]=useState(()=>createLocalWorkspaceRepository(localStorage)), [game,setGame]=useState<Game|null>(null)

  const [name,setName]=useState(''), [error,setError]=useState(''), [busy,setBusy]=useState(false), [loaded,setLoaded]=useState(false)

  const identityKey=`snapquest-preview-player-${gameId}`

  const [playerId,setPlayerId]=useState(()=>sessionStorage.getItem(identityKey))

  const now=useClock()

  useEffect(()=>{let stopped=false;async function refresh(){try{const data=await repository.load();if(!stopped){setGame(data.games.find(g=>g.id===gameId)??null);setLoaded(true)}}catch(err){if(!stopped){setError(err instanceof Error?err.message:'Could not load preview.');setLoaded(true)}}}void refresh();const timer=setInterval(()=>void refresh(),1500);window.addEventListener('storage',refresh);return()=>{stopped=true;clearInterval(timer);window.removeEventListener('storage',refresh)}},[repository,gameId])

  const player=game?.players?.find(p=>p.id===playerId), state=game?gameRuntime(game,now):'setup'

  async function join(event: FormEvent){event.preventDefault();setBusy(true);setError('');try{const updated=await repository.joinGame(gameId,token,name);const last=updated.players?.at(-1);if(last){sessionStorage.setItem(identityKey,last.id);setPlayerId(last.id)}setGame(updated)}catch(err){setError(err instanceof Error?err.message:'Could not join')}finally{setBusy(false)}}

  return <main className="participant-shell local-player-preview"><header className="participant-topbar"><a className="brand" href={`#/dev/games/${gameId}`}>SnapQuest · Player preview</a></header><div className="local-demo-banner">Browser-local player simulation · no Supabase registration</div>{error&&<p className="v12-error" role="alert">{error}</p>}{!game?<p>{loaded?'Game unavailable in this browser.':'Opening the player lobby…'}</p>:<section className="waiting-card"><h1>{game.name}</h1><p>{game.huntSnapshot.title}</p>{player?<><span className="v12-tag">{game.teams?.find(t=>t.id===player.teamId)?.name}</span><h2>{state==='scheduled'?'Get ready!':state==='active'?'The hunt is on!':'Game ended'}</h2><div className="lobby-countdown" role="timer">{countdown(state==='scheduled'?Date.parse(game.startAt??'')-now:state==='active'?gameDeadline(game)-now:0)}</div><p>{state==='scheduled'?'Your challenge list opens when the game starts.':state==='active'?'Timing is simulated using this browser’s clock.':'Submissions are closed.'}</p><h3>Your team</h3><ul>{game.players?.filter(p=>p.teamId===player.teamId).map(p=><li key={p.id}>{p.name}</li>)}</ul>{state==='active'&&<ol>{game.huntSnapshot.challenges.map(c=><li key={c.id}>{c.title}</li>)}</ol>}</>:game.invites?.some(i=>i.token===token)&&['scheduled','active'].includes(state)?<form onSubmit={join}><label>Your name<input required maxLength={40} value={name} onChange={e=>setName(e.target.value)}/></label><button className="primary-button" disabled={busy}>Join preview game</button></form>:<p>This invitation has been replaced or registration has closed.</p>}<h3>Ground rules</h3><ul>{game.huntSnapshot.rules.map((rule,i)=><li key={i}>{rule}</li>)}</ul></section>}</main>

}

