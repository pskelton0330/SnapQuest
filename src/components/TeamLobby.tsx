import { Camera, Check, RefreshCw, UserRound, Users } from 'lucide-react'

type Team = { id: string; name: string; display_color: string; selfieUrl?: string; selfieSubmittedAt?: string; selfiePreviewUnavailable?: boolean }
type Participant = { id: string; team_id: string; display_name: string }
type TeamLobbyProps = { teams: Team[]; participants: Participant[]; onRefresh?: () => void }

export default function TeamLobby({ teams, participants, onRefresh }: TeamLobbyProps) {
  return <section className="team-lobby-section" aria-label="Team lobby">
    <div className="team-lobby-heading"><div><h2>Team lobby</h2><p>See who has joined each team and whether their team selfie is ready.</p></div><div className="team-lobby-actions"><span><Users size={15}/> {participants.length} joined</span>{onRefresh && <button className="outline-button" type="button" onClick={onRefresh}><RefreshCw size={13}/> Refresh</button>}</div></div>
    {teams.length ? <div className="team-lobby-grid">{teams.map(team => {
      const members = participants.filter(participant => participant.team_id === team.id)
      return <article className="team-lobby-card" key={team.id}>
        <header><span className="team-swatch" style={{ backgroundColor: team.display_color }}/><h3>{team.name}</h3><span className="team-member-count">{members.length} {members.length === 1 ? 'member' : 'members'}</span></header>
        {team.selfieUrl ? <><img className="team-lobby-selfie" src={team.selfieUrl} alt={`${team.name} team selfie`}/><p className="team-selfie-saved"><Check size={13}/> Selfie saved{team.selfieSubmittedAt ? ` · ${new Date(team.selfieSubmittedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}</p></> : team.selfieSubmittedAt ? <div className="team-lobby-no-selfie"><Camera size={18}/><span>Selfie saved; preview unavailable. Refresh to retry.</span></div> : <div className="team-lobby-no-selfie"><Camera size={18}/><span>No team selfie yet</span></div>}
        <ul>{members.length ? members.map(member => <li key={member.id}><span className="participant-avatar"><UserRound size={13}/></span><b>{member.display_name}</b><span className="member-present">Joined</span></li>) : <li className="team-lobby-empty">Waiting for teammates to join</li>}</ul>
      </article>
    })}</div> : <div className="locked-note"><Users size={15}/> Teams will appear after the hunt is published.</div>}
  </section>
}
