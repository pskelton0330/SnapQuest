import type { Challenge, Game, HuntTemplate } from './workspace'

export const SUGGESTED_RULES = [
  { id: 'participant-in-frame', text: 'Every photo should show at least one team participant together with the item.', recommended: true },
  { id: 'stay-in-venue', text: 'Stay within the event venue and areas open to your group.', recommended: false },
  { id: 'respect-others', text: 'Ask permission before including anyone outside your team in a photo.', recommended: false },
  { id: 'play-safely', text: 'Walk, stay together, and skip anything that feels unsafe.', recommended: false },
]


export function importChallenges(text: string, existing: Challenge[], makeId: () => string, stripListMarkers = false): Challenge[] {
  const titles = text.split(/\r?\n/).map(line => stripListMarkers ? line.trim().replace(/^(?:[-*•]\s+|\d+[.)]\s+)/, '').trim() : line.trim()).filter(Boolean)


  if (!titles.length) throw new Error('Paste at least one challenge, one per line.')

  if (titles.length + existing.length > 100) throw new Error('A hunt can contain up to 100 challenges. Nothing was imported.')

  if (titles.some(title => title.length > 120)) throw new Error('Keep each challenge title to 120 characters or fewer. Nothing was imported.')

  return [...existing, ...titles.map(title => ({ id: makeId(), title, description: '', points: 1 }))]

}

export function moveItem<T>(items: T[], index: number, direction: -1 | 1): T[] {

  const target = index + direction

  if (index < 0 || index >= items.length || target < 0 || target >= items.length) return items

  const result = [...items]; [result[index], result[target]] = [result[target], result[index]]

  return result

}

export function moveChallenge(items: Challenge[], index: number, direction: -1 | 1): Challenge[] {
  return moveItem(items, index, direction)
}

export function validateHuntDraft(hunt: HuntTemplate, detailsOnly = false): string | null {

  if (!hunt.title.trim() || hunt.title.trim().length > 120) return 'Enter a hunt title of 1–120 characters.'

  if (!hunt.venue.trim() || hunt.venue.trim().length > 160) return 'Enter a venue of 1–160 characters.'

  if (hunt.description.length > 1000) return 'Keep the description to 1,000 characters or fewer.'

  if (!Number.isInteger(hunt.defaultDuration) || hunt.defaultDuration < 5 || hunt.defaultDuration > 1440) return 'Choose a whole-number duration of 5–1,440 minutes.'

  if (hunt.rules.length > 30 || hunt.rules.some(rule => rule.length > 1000)) return 'Use up to 30 rules, each 1,000 characters or fewer.'

  if (detailsOnly) return null

  if (hunt.challenges.length < 1 || hunt.challenges.length > 100) return 'Add between 1 and 100 challenges.'

  if (hunt.challenges.some(c => !c.title.trim() || c.title.trim().length > 120 || c.description.length > 1000 || !Number.isInteger(c.points) || c.points < 0 || c.points > 1000)) return 'Each challenge needs a title, instructions up to 1,000 characters, and whole-number points from 0 to 1,000.'

  return null

}

export function completedPlayCounts(games: Game[]): Map<string, number> {

  const counts = new Map<string, number>(), seen = new Set<string>()

  for (const game of games) if (game.status === 'completed' && game.templateId && !seen.has(game.id)) {

    seen.add(game.id); counts.set(game.templateId, (counts.get(game.templateId) ?? 0) + 1)

  }

  return counts

}

export type HuntFilters = { search: string; venue: string; creator: string; sort: 'popular' | 'newest' }

export function discoverHunts(hunts: HuntTemplate[], games: Game[], filters: HuntFilters): HuntTemplate[] {

  const counts = completedPlayCounts(games), query = filters.search.trim().toLocaleLowerCase()

  return hunts.filter(h => h.title.toLocaleLowerCase().includes(query) && (!filters.venue || h.venue === filters.venue) && (!filters.creator || h.creatorId === filters.creator))

    .sort((a, b) => (filters.sort === 'popular' ? (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) : 0) || Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id))

}

