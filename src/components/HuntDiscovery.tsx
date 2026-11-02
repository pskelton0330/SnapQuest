import { useState } from 'react'
import { HuntCard } from './WorkspaceCards'
import { completedPlayCounts, discoverHunts, type HuntFilters } from '../lib/huntEditor'
import type { Game, HuntTemplate } from '../lib/workspace'

export default function HuntDiscovery({ hunts, games, page }: { hunts: HuntTemplate[]; games: Game[]; page: 'browse' | 'hunts' }) {
  const [filters, setFilters] = useState<HuntFilters>({ search: '', venue: '', creator: '', sort: 'popular' })
  const results = discoverHunts(hunts, games, filters), counts = completedPlayCounts(games)
  const creators = Array.from(new Map(hunts.map(h => [h.creatorId, h.creatorName])).entries())
  return <>
    <div className="discovery-controls"><label>Search hunt titles<input type="search" placeholder="Find your next adventure…" value={filters.search} onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}/></label><label>Venue<select value={filters.venue} onChange={e => setFilters(f => ({ ...f, venue: e.target.value }))}><option value="">All venues</option>{Array.from(new Set(hunts.map(h => h.venue))).sort().map(venue => <option key={venue}>{venue}</option>)}</select></label><label>Creator<select value={filters.creator} onChange={e => setFilters(f => ({ ...f, creator: e.target.value }))}><option value="">All creators</option>{creators.map(([id,name]) => <option key={id} value={id}>{name}</option>)}</select></label><label>Sort by<select value={filters.sort} onChange={e => setFilters(f => ({ ...f, sort: e.target.value as HuntFilters['sort'] }))}><option value="popular">Most popular</option><option value="newest">Newest</option></select></label></div>
    <p className="discovery-count" role="status">{results.length} {results.length === 1 ? 'hunt' : 'hunts'} found · popularity uses completed preview games only</p>
    <div className="v12-card-grid">{results.map(hunt => <HuntCard key={hunt.id} hunt={hunt} page={page} completedPlays={counts.get(hunt.id) ?? 0}/>)}</div>
    {!results.length && <div className="v12-empty"><h2>No matching hunts</h2><p>Try another search or clear your filters.</p><button className="outline-button" onClick={() => setFilters({ search: '', venue: '', creator: '', sort: 'popular' })}>Clear filters</button></div>}
  </>
}
