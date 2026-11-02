import type { Game } from './workspace'
export type SetupIntent = 'now' | 'schedule'
export type GameTeam = { id: string; name: string; color: string }
export type DemoPlayer = { id: string; name: string; teamId: string }
export type DemoInvite = { token: string; teamId: string | null }
export type GameSetup = { name: string; duration: number; teamNames: string[]; assignment: 'organizer' | 'balanced'; startAt: string; startNow?: boolean; voting: boolean; bonus: number }
export type GameCommand = { type: 'start' } | { type: 'reschedule'; startAt: string } | { type: 'extend'; minutes: number } | { type: 'end' } | { type: 'rotate' }
const colors = ['#d63f38','#0068b4','#148b68','#d39b0c','#8052a3','#007f98','#db7040','#ad4377','#49734b','#526275','#7d5480','#3a7580']
export function gameDeadline(game: Game): number { return game.endedAt ? Date.parse(game.endedAt) : Date.parse(game.startAt ?? '') + game.duration * 60000 }
export function gameRuntime(game: Game, now: number): 'setup' | 'scheduled' | 'active' | 'ended' | 'review' | 'completed' {
  if (game.status === 'completed' || game.status === 'review' || game.status === 'setup') return game.status
  if (game.endedAt || now >= gameDeadline(game)) return 'ended'
  return !game.startAt || now < Date.parse(game.startAt) ? 'scheduled' : 'active'
}
export function validateGameSetup(setup: GameSetup, now: number): string | null {
  if (!setup.name.trim() || setup.name.trim().length > 120) return 'Enter a game name of 1–120 characters.'
  if (!Number.isInteger(setup.duration) || setup.duration < 5 || setup.duration > 1440) return 'Duration must be a whole number from 5 to 1,440 minutes.'
  if (setup.teamNames.length < 2 || setup.teamNames.length > 12 || setup.teamNames.some(n => !n.trim() || n.trim().length > 40)) return 'Use 2–12 teams, with names of 1–40 characters.'
  if (new Set(setup.teamNames.map(n => n.trim().toLowerCase())).size !== setup.teamNames.length) return 'Team names must be unique.'
  if (!['organizer','balanced'].includes(setup.assignment)) return 'Choose a team assignment mode.'
  if (!setup.startNow && (!Number.isFinite(Date.parse(setup.startAt)) || Date.parse(setup.startAt) <= now)) return 'Choose a start time in the future.'
  if (!Number.isInteger(setup.bonus) || setup.bonus < 0 || setup.bonus > 1000) return 'Voting bonus must be a whole number from 0 to 1,000.'
  return null
}
export function configureLocalGame(game: Game, setup: GameSetup, now: number, id: () => string): Game {
  if (game.status !== 'setup') throw new Error('Only a setup draft can be configured.')
  const problem = validateGameSetup(setup, now)
  if (problem) throw new Error(problem)
  const teams = setup.teamNames.map((name,i) => ({ id: id(), name: name.trim(), color: colors[i] }))
  return { ...game, name: setup.name.trim(), duration: setup.duration, startAt: setup.startNow ? new Date(now).toISOString() : setup.startAt, status: setup.startNow ? 'active' : 'scheduled',
    assignment: setup.assignment, voting: setup.voting, votingBonus: setup.voting ? setup.bonus : 0, teams, players: [],
    invites: setup.assignment === 'balanced' ? [{ token: id(), teamId: null }] : teams.map(t => ({ token: id(), teamId: t.id })) }
}
export function applyGameCommand(game: Game, command: GameCommand, now: number, id: () => string): Game {
  const state = gameRuntime(game, now)
  if (command.type === 'start' || command.type === 'reschedule') {
    if (state !== 'scheduled') throw new Error('Only a game that has not begun can be started or rescheduled.')
    if (command.type === 'reschedule' && (!Number.isFinite(Date.parse(command.startAt)) || Date.parse(command.startAt) <= now)) throw new Error('Choose a start time in the future.')
    return { ...game, startAt: command.type === 'start' ? new Date(now).toISOString() : command.startAt, status: command.type === 'start' ? 'active' : 'scheduled' }
  }
  if (command.type === 'extend') {
    if (state !== 'active') throw new Error('Time can only be added while the game is active.')
    if (!Number.isInteger(command.minutes) || command.minutes < 1 || command.minutes > 120 || game.duration + command.minutes > 1440) throw new Error('Add 1–120 whole minutes, up to a total duration of 24 hours.')
    return { ...game, duration: game.duration + command.minutes }
  }
  if (command.type === 'end') {
    if (!['scheduled','active','ended'].includes(state)) throw new Error('This game cannot move into review.')
    return { ...game, status: 'review', endedAt: new Date(Math.min(now, gameDeadline(game))).toISOString() }
  }
  if (!['scheduled','active'].includes(state)) throw new Error('Invitations are only available before the game ends.')
  return { ...game, invites: game.assignment === 'balanced' ? [{ token: id(), teamId: null }] : (game.teams ?? []).map(t => ({ token: id(), teamId: t.id })) }
}
export function joinLocalGame(game: Game, token: string, name: string, now: number, id: () => string, random: () => number = Math.random): Game {
  if (!['scheduled','active'].includes(gameRuntime(game, now))) throw new Error('Registration has closed.')
  if (!name.trim() || name.trim().length > 40) throw new Error('Enter a participant name of 1–40 characters.')
  const invite = game.invites?.find(i => i.token === token)
  if (!invite) throw new Error('This preview invitation has been replaced or is invalid.')
  const teams = game.teams ?? [], players = game.players ?? []
  const sizes = teams.map(t => players.filter(p => p.teamId === t.id).length), minimum = Math.min(...sizes)
  const smallest = teams.filter((_,i) => sizes[i] === minimum)
  const teamId = invite.teamId ?? smallest[Math.min(smallest.length - 1, Math.floor(random() * smallest.length))]?.id
  if (!teamId || !teams.some(t => t.id === teamId)) throw new Error('The assigned team is unavailable.')
  return { ...game, players: [...players, { id: id(), name: name.trim(), teamId }] }
}
export function countdown(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000))
  return `${Math.floor(seconds / 3600).toString().padStart(2,'0')}:${Math.floor(seconds / 60 % 60).toString().padStart(2,'0')}:${(seconds % 60).toString().padStart(2,'0')}`
}
