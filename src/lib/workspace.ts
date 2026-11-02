import { validateHuntDraft } from './huntEditor.ts'
import { configureLocalGame, applyGameCommand, joinLocalGame, type SetupIntent, type GameSetup, type GameCommand, type GameTeam, type DemoPlayer, type DemoInvite } from './gameManagement.ts'
export type Challenge = { id: string; title: string; description: string; points: number }
export type HuntTemplate = {
  id: string; title: string; venue: string; description: string; creatorId: string; creatorName: string;
  visibility: 'public' | 'personal'; rules: string[]; defaultDuration: number; challenges: Challenge[]; createdAt: string
}
export type GameStatus = 'setup' | 'scheduled' | 'active' | 'review' | 'completed'
export type Game = {
  id: string; templateId: string | null; name: string; status: GameStatus; startAt: string | null;
  duration: number; createdAt: string; huntSnapshot: HuntTemplate
  setupIntent?: SetupIntent; teams?: GameTeam[]; players?: DemoPlayer[]; invites?: DemoInvite[];
  assignment?: 'organizer' | 'balanced'; voting?: boolean; votingBonus?: number; endedAt?: string | null
  clockOffsetMs?: number
}
export type WorkspaceData = { version: 1; hunts: HuntTemplate[]; games: Game[] }
export type WorkspaceRepository = {
  load(): Promise<WorkspaceData>
  saveHunt(hunt: HuntTemplate): Promise<HuntTemplate>
  createGame(templateId: string, id: string, createdAt: string, intent?: SetupIntent): Promise<Game>
  copyHunt(templateId: string, id: string, createdAt: string): Promise<HuntTemplate>
}
export type GameManagementRepository = WorkspaceRepository & {
  configureGame(id: string, setup: GameSetup): Promise<Game>
  commandGame(id: string, command: GameCommand): Promise<Game>
}
export type LocalGameRepository = GameManagementRepository & {
  joinGame(id: string, token: string, name: string): Promise<Game>
}
export type WorkspaceRoute = { page: 'browse' | 'hunts' | 'games' | 'create'; id?: string }
export function parseWorkspaceRoute(hash: string): WorkspaceRoute {
  const match = hash.match(/^#\/dev\/(browse|hunts|games|create)(?:\/([a-zA-Z0-9-]+))?$/)
  return match ? { page: match[1] as WorkspaceRoute['page'], id: match[2] } : { page: 'browse' }
}
export const LOCAL_CREATOR = 'local-organizer'
export const WORKSPACE_KEY = 'snapquest-development-workspace-v1'
export const LEGACY_KEY = 'snapquest-local-development-drafts'
type StorageAccess = Pick<Storage, 'getItem' | 'setItem'>

function validHunt(value: unknown): value is HuntTemplate {
  if (!value || typeof value !== 'object') return false
  const h = value as HuntTemplate
  return ['id','title','venue','description','creatorId','creatorName','createdAt'].every(key => typeof h[key as keyof HuntTemplate] === 'string')
    && ['public','personal'].includes(h.visibility) && Number.isFinite(h.defaultDuration) && h.defaultDuration >= 5
    && Array.isArray(h.rules) && h.rules.every(r => typeof r === 'string')
    && Array.isArray(h.challenges) && h.challenges.every(c => c && typeof c.id === 'string' && typeof c.title === 'string' && typeof c.description === 'string' && Number.isInteger(c.points) && c.points >= 0)
}
function validate(value: unknown): WorkspaceData {
  const d = value as WorkspaceData
  if (!d || d.version !== 1 || !Array.isArray(d.hunts) || !d.hunts.every(validHunt) || !Array.isArray(d.games)
    || !d.games.every(g => g && typeof g.id === 'string' && typeof g.name === 'string' && typeof g.templateId === 'string'
      && ['setup','scheduled','active','review','completed'].includes(g.status) && (g.startAt === null || typeof g.startAt === 'string')
      && typeof g.createdAt === 'string' && Number.isFinite(g.duration) && validHunt(g.huntSnapshot))) {
    throw new Error('Saved preview data could not be read. It has been preserved; no data was overwritten.')
  }
  return d
}
export function sampleWorkspace(): WorkspaceData {
  const hunt = (id: string, title: string, venue: string, names: string[], mine = false): HuntTemplate => ({
    id, title, venue, description: 'Sample hunt for exploring the SnapQuest interface.', creatorId: mine ? LOCAL_CREATOR : 'sample-creator',
    creatorName: mine ? 'You (local preview)' : 'SnapQuest samples', visibility: mine ? 'personal' : 'public',
    rules: ['Include a team participant with the item in each photo.'], defaultDuration: 60,
    challenges: names.map((title, i) => ({ id: `${id}-${i}`, title, description: '', points: 1 })), createdAt: '2026-10-29T12:00:00Z',
  })
  const hunts = [hunt('sample-craft', 'Craft Store Adventure', 'Craft store', ['Something red', 'A funny sign', 'Something round']),
    hunt('sample-park', 'Park Explorers', 'Local park', ['A leaf bigger than your hand', 'A team selfie', 'Something that flies']),
    hunt('sample-family', 'Family Favorites', 'Anywhere', ['Something yellow', 'A family photo'], true)]
  return { version: 1, hunts, games: [
    { id: 'sample-scheduled', templateId: hunts[0].id, name: 'Saturday Family Game', status: 'scheduled', startAt: '2030-01-05T15:00:00Z', duration: 60, createdAt: hunts[0].createdAt, huntSnapshot: structuredClone(hunts[0]) },
    { id: 'sample-completed', templateId: hunts[1].id, name: 'Sample Park Game', status: 'completed', startAt: '2026-10-28T15:00:00Z', duration: 60, createdAt: hunts[1].createdAt, huntSnapshot: structuredClone(hunts[1]) },
  ] }
}
export function migrateLegacy(raw: string | null, data: WorkspaceData): WorkspaceData {
  if (!raw) return data
  const drafts: unknown = JSON.parse(raw)
  if (!Array.isArray(drafts)) throw new Error('Existing local drafts have an unsupported format. They have been preserved.')
  for (const value of drafts) {
    const d = value as { id: string; title: string; venue: string; duration: number; rules: string; items: string[]; createdAt: string }
    if (!d || !['id','title','venue','rules','createdAt'].every(key => typeof d[key as keyof typeof d] === 'string') || !Array.isArray(d.items) || !d.items.every(i => typeof i === 'string') || !Number.isFinite(d.duration)) throw new Error('An existing local draft could not be imported. Original drafts have been preserved.')
    data.hunts.push({ id: d.id, title: d.title, venue: d.venue, description: '', creatorId: LOCAL_CREATOR, creatorName: 'You (local preview)', visibility: 'personal', defaultDuration: d.duration, rules: d.rules ? [d.rules] : [], challenges: d.items.map((title, i) => ({ id: `${d.id}-${i}`, title, description: '', points: 1 })), createdAt: d.createdAt })
  }
  return validate(data)
}
export function createLocalWorkspaceRepository(storage: StorageAccess, clock: () => number = Date.now): LocalGameRepository {
  async function load() {
    try {
      const raw = storage.getItem(WORKSPACE_KEY)
      if (raw !== null) return validate(JSON.parse(raw))
      const data = migrateLegacy(storage.getItem(LEGACY_KEY), sampleWorkspace())
      storage.setItem(WORKSPACE_KEY, JSON.stringify(data))
      return data
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'Browser storage is unavailable.')
    }
  }
  async function updateGame(id: string, operation: (game: Game) => Game): Promise<Game> {
    const mutate = async () => {
      const data = await load(), current = data.games.find(g => g.id === id)
      if (!current) throw new Error('Game not found.')
      const game = operation(current)
      data.games = data.games.map(g => g.id === id ? game : g)
      storage.setItem(WORKSPACE_KEY, JSON.stringify(data))
      return structuredClone(game)
    }
    if (typeof navigator !== 'undefined' && navigator.locks) return navigator.locks.request('snapquest-local-game-write', mutate)
    return mutate()
  }
  return {
    load,
    configureGame: (id, setup) => updateGame(id, game => configureLocalGame(game, setup, clock(), () => crypto.randomUUID())),
    commandGame: (id, command) => updateGame(id, game => applyGameCommand(game, command, clock(), () => crypto.randomUUID())),
    joinGame: (id, token, name) => updateGame(id, game => joinLocalGame(game, token, name, clock(), () => crypto.randomUUID())),
    async saveHunt(hunt) {
      if (!validHunt(hunt) || hunt.creatorId !== LOCAL_CREATOR) throw new Error('A valid local hunt is required.')
      const problem = validateHuntDraft(hunt)
      if (problem) throw new Error(problem)
      const data = await load()
      const previous = data.hunts.find(h => h.id === hunt.id)
      if (previous && previous.creatorId !== LOCAL_CREATOR) throw new Error('Sample public hunts cannot be edited.')
      data.hunts = [structuredClone(hunt), ...data.hunts.filter(h => h.id !== hunt.id)]
      storage.setItem(WORKSPACE_KEY, JSON.stringify(data))
      return structuredClone(hunt)
    },
    async createGame(templateId, id, createdAt, intent = 'schedule') {
      const data = await load()
      const template = data.hunts.find(h => h.id === templateId)
      if (!template) throw new Error('Hunt not found.')
      if (data.games.some(g => g.id === id)) throw new Error('Game already exists.')
      const game: Game = { id, templateId, name: `${template.title} Game`, status: 'setup', startAt: null, duration: template.defaultDuration, createdAt, huntSnapshot: structuredClone(template), setupIntent: intent }
      data.games.unshift(game)
      storage.setItem(WORKSPACE_KEY, JSON.stringify(data))
      return structuredClone(game)
    },
    async copyHunt(templateId, id, createdAt) {
      const data = await load()
      const source = data.hunts.find(h => h.id === templateId)
      if (!source) throw new Error('Hunt not found.')
      if (data.hunts.some(h => h.id === id)) throw new Error('Hunt already exists.')
      const copy: HuntTemplate = { ...structuredClone(source), id, creatorId: LOCAL_CREATOR, creatorName: 'You (local preview)', visibility: 'personal', createdAt,
        challenges: source.challenges.map((c, i) => ({ ...c, id: `${id}-${i}` })) }
      data.hunts.unshift(copy)
      storage.setItem(WORKSPACE_KEY, JSON.stringify(data))
      return structuredClone(copy)
    },
  }
}
