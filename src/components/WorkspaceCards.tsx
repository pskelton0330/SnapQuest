import { MapPin, ClipboardList, CalendarDays } from 'lucide-react'
import type { HuntTemplate, Game } from '../lib/workspace'

export function HuntCard({ hunt, page, completedPlays = 0 }: { hunt: HuntTemplate; page: 'browse' | 'hunts'; completedPlays?: number }) {
  return <article className="v12-card"><div className="v12-card-icon"><MapPin size={22}/></div><span className="v12-tag">{hunt.visibility === 'public' ? 'Public preview hunt' : 'Personal hunt'}</span><h2>{hunt.title}</h2><p>{hunt.venue}</p><p>{hunt.description}</p><div className="v12-card-meta"><span><ClipboardList size={14}/> {hunt.challenges.length} challenges</span><span>{hunt.defaultDuration} min</span></div><small>Created by {hunt.creatorName}</small><small>{completedPlays} completed preview {completedPlays === 1 ? 'game' : 'games'}</small><a className="outline-button" href={`#/dev/${page}/${hunt.id}`}>View hunt</a></article>
}
export function GameCard({ game }: { game: Game }) {
  return <article className="v12-card"><div className="v12-card-icon"><CalendarDays size={22}/></div><span className="v12-tag">{game.status === 'setup' ? 'Needs setup' : game.status === 'review' ? 'Awaiting review' : game.status}</span><h2>{game.name}</h2><p>Hunt: {game.huntSnapshot.title}</p><div className="v12-card-meta"><span>{game.duration} min</span><span>{game.startAt ? new Date(game.startAt).toLocaleString() : 'Start time not set'}</span></div><a className="outline-button" href={`#/dev/games/${game.id}`}>Manage game</a></article>
}
