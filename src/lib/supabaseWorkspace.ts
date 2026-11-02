import type { SupabaseClient } from '@supabase/supabase-js'
import type { GameManagementRepository, HuntTemplate, Game, GameStatus } from './workspace'

type GameRow = {
  id: string; template_id: string | null; title: string; venue: string; description: string | null; rules: string[];
  status: string; start_at: string | null; duration_minutes: number; created_at: string; template_snapshot: HuntTemplate | null
  ended_at?: string | null; team_assignment_mode?: 'organizer'|'balanced'; voting_enabled?: boolean; voting_bonus_points?: number
}
type ItemRow = { id: string; hunt_id: string; title_snapshot: string; description_snapshot: string | null; point_value: number }
export function mapGameRow(row: GameRow, items: ItemRow[] = []): Game {
  return { id: row.id, templateId: row.template_id, name: row.title, status: row.status === 'draft' ? 'setup' : row.status as GameStatus,
    startAt: row.start_at, duration: row.duration_minutes, createdAt: row.created_at,
    endedAt: row.ended_at, assignment: row.team_assignment_mode, voting: row.voting_enabled, votingBonus: row.voting_bonus_points,
    huntSnapshot: row.template_snapshot ?? { id: row.template_id ?? row.id, title: row.title, venue: row.venue, description: row.description ?? '', rules: row.rules,
      defaultDuration: row.duration_minutes, createdAt: row.created_at, creatorId: '', creatorName: 'Legacy organizer', visibility: 'personal',
      challenges: items.filter(i => i.hunt_id === row.id).map(i => ({ id: i.id, title: i.title_snapshot, description: i.description_snapshot ?? '', points: i.point_value })) } }
}

// Inject an authenticated client and the provisioned organizer's ID. No service key.
// This adapter is prepared for the later switch from local UI refinement to Supabase.
export function createSupabaseWorkspaceRepository(client: SupabaseClient, organizerId: string): GameManagementRepository {
  async function templates(owned: boolean): Promise<HuntTemplate[]> {
    const { data, error } = await client.rpc('list_hunt_templates', { p_owned: owned })
    if (error) throw error
    return (data ?? []) as HuntTemplate[]
  }
  async function game(id: string): Promise<Game> {
    const { data, error } = await client.from('hunts').select('*').eq('id', id).eq('organizer_id', organizerId).single()
    if (error) throw error
    return hydrate(mapGameRow(data as GameRow))
  }
  async function hydrate(game: Game): Promise<Game> {
    const { data, error } = await client.rpc('get_game_lobby', { p_game_id: game.id })
    if (error) throw error
    return { ...game, teams: data.teams, players: data.players, clockOffsetMs: Date.parse(data.server_now) - Date.now() }
  }
  return {
    async configureGame(id, setup) {
      const { data, error } = await client.rpc('configure_game', { p_game_id:id, p_name:setup.name, p_duration:setup.duration, p_team_names:setup.teamNames,
        p_assignment_mode:setup.assignment, p_start_at:setup.startNow?null:setup.startAt, p_start_now:setup.startNow??false, p_voting_enabled:setup.voting, p_bonus:setup.bonus })
      if (error) throw error
      return { ...await game(id), invites:(data??[]).map((row: {team_id:string|null;invite_token:string})=>({ teamId:row.team_id,token:row.invite_token })) }
    },
    async commandGame(id, command) {
      const args = command.type==='reschedule' ? {p_game_id:id,p_start_at:command.startAt} : command.type==='extend' ? {p_game_id:id,p_minutes:command.minutes} : command.type==='end'||command.type==='rotate' ? {p_hunt_id:id} : {p_game_id:id}
      const rpc = {start:'start_game_now',reschedule:'reschedule_game',extend:'add_game_time',end:'end_hunt_early',rotate:'regenerate_hunt_invites'}[command.type]
      const {data,error}=await client.rpc(rpc,args)
      if(error) throw error
      const updated=await game(id)
      return command.type==='rotate' ? {...updated,invites:(data??[]).map((row:{team_id:string|null;invite_token:string})=>({teamId:row.team_id,token:row.invite_token}))} : updated
    },
    async load() {
      const [publicHunts, ownedHunts] = await Promise.all([templates(false), templates(true)])
      const { data, error } = await client.from('hunts').select('*').eq('organizer_id', organizerId).neq('status', 'archived').order('created_at', { ascending: false })
      if (error) throw error
      const rows = (data ?? []) as GameRow[]
      const legacyIds = rows.filter(r => !r.template_snapshot).map(r => r.id)
      let items: ItemRow[] = []
      if (legacyIds.length) {
        const result = await client.from('hunt_items').select('id,hunt_id,title_snapshot,description_snapshot,point_value').in('hunt_id', legacyIds).order('display_order')
        if (result.error) throw result.error
        items = result.data ?? []
      }
      return { version: 1, hunts: Array.from(new Map([...publicHunts, ...ownedHunts].map(h => [h.id, h])).values()), games: await Promise.all(rows.map(row => hydrate(mapGameRow(row, items)))) }
    },
    async saveHunt(hunt) {
      // Decide create vs update from server-owned IDs; local/sample IDs are never submitted as DB identifiers.
      const owned = await templates(true)
      const { data, error } = await client.rpc('save_hunt_template', { p_title: hunt.title, p_venue: hunt.venue, p_description: hunt.description, p_rules: hunt.rules,
        p_items: hunt.challenges, p_duration: hunt.defaultDuration, p_visibility: hunt.visibility, p_template_id: owned.some(h => h.id === hunt.id) ? hunt.id : null })
      if (error) throw error
      const saved = (await templates(true)).find(h => h.id === data)
      if (!saved) throw new Error('Saved hunt could not be loaded.')
      return saved
    },
    async createGame(templateId, _id, _date, intent) {
      const { data, error } = await client.rpc('create_game_from_template', { p_template_id: templateId })
      if (error) throw error
      return { ...await game(data as string), setupIntent:intent }
    },
    async copyHunt(templateId) {
      const { data, error } = await client.rpc('copy_hunt_template', { p_template_id: templateId })
      if (error) throw error
      const copy = (await templates(true)).find(h => h.id === data)
      if (!copy) throw new Error('Saved copy could not be loaded.')
      return copy
    },
  }
}
