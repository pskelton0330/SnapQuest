import { useEffect, useState } from 'react'
import { ArrowUp, ArrowDown, Plus, Trash2, Search } from 'lucide-react'
import { importChallenges, moveChallenge, SUGGESTED_RULES, validateHuntDraft } from '../lib/huntEditor'
import type { SetupIntent } from '../lib/gameManagement'
import { LOCAL_CREATOR, type Challenge, type HuntTemplate } from '../lib/workspace'

const suggestions = SUGGESTED_RULES.map(rule => rule.text)
type Props = { initial?: HuntTemplate; ideas: Challenge[]; onSave: (hunt: HuntTemplate) => Promise<HuntTemplate>; onGame: (id: string, intent?: SetupIntent) => Promise<void> }
export default function HuntEditor({ initial, ideas, onSave, onGame }: Props) {
  const storageKey = `snapquest-editor-v1-${initial?.id ?? 'new'}`
  const [initialState] = useState(() => {
    try {
      const cached = JSON.parse(localStorage.getItem(storageKey) ?? 'null')
      if (cached?.draft && typeof cached.draft.title === 'string' && Array.isArray(cached.draft.challenges) && Array.isArray(cached.draft.rules) && Number.isInteger(cached.step) && cached.step >= 0 && cached.step <= 3) return cached as { draft: HuntTemplate; step: number; paste?: string }
    } catch { /* A damaged unsaved editor cache does not replace a saved hunt. */ }
    return { draft: initial ? structuredClone(initial) : { id: crypto.randomUUID(), title: '', venue: '', description: '', creatorId: LOCAL_CREATOR, creatorName: 'You (local preview)', visibility: 'public' as const, rules: [suggestions[0]], defaultDuration: 60, challenges: [], createdAt: new Date().toISOString() }, step: 0 }
  })
  const [draft, setDraft] = useState<HuntTemplate>(initialState.draft)
  const [step, setStep] = useState(initialState.step)
  const [paste, setPaste] = useState(initialState.paste ?? '')
  const [search, setSearch] = useState('')
  const [stripListMarkers, setStripListMarkers] = useState(false)
  const [error, setError] = useState('')
  const [storageNotice, setStorageNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState<HuntTemplate | null>(null)
  // Report the result of external browser-storage IO to the editor.
  /* eslint-disable react/set-state-in-effect */
  useEffect(() => {
    if (saved) return
    try { localStorage.setItem(storageKey, JSON.stringify({ draft, step, paste })); setStorageNotice('Draft automatically kept in this browser.') }
    catch { setStorageNotice('Browser storage is unavailable. Keep this page open until you save.') }
  }, [draft, step, paste, storageKey, saved])
  /* eslint-enable react/set-state-in-effect */
  function change<K extends keyof HuntTemplate>(key: K, value: HuntTemplate[K]) { setDraft(d => ({ ...d, [key]: value })); setError('') }
  function update(id: string, patch: Partial<Challenge>) { change('challenges', draft.challenges.map(c => c.id === id ? { ...c, ...patch } : c)) }
  function go(next: number) {
    const problem = next > step ? validateHuntDraft(draft, next < 3) : null
    if (problem) { setError(problem); return }
    setError(''); setStep(next)
  }
  async function save() {
    const problem = validateHuntDraft(draft)
    if (problem) { setError(problem); return }
    setBusy(true); setError('')
    try {
      const result = await onSave({ ...draft, title: draft.title.trim(), venue: draft.venue.trim(), rules: draft.rules.map(r => r.trim()).filter(Boolean), challenges: draft.challenges.map(c => ({ ...c, title: c.title.trim() })) })
      setSaved(result)
      try { localStorage.removeItem(storageKey) } catch { /* Saved data is authoritative. */ }
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save your hunt.') }
    finally { setBusy(false) }
  }
  const seen = new Set<string>()
  const choices = ideas.filter(c => { const key = c.title.trim().toLowerCase(); if (seen.has(key)) return false; seen.add(key); return `${c.title} ${c.description}`.toLowerCase().includes(search.toLowerCase()) }).slice(0, 12)
  if (saved) return <section className="v12-card editor-success"><h1>Hunt saved!</h1><p>{saved.title} is ready to use for a game. Creating a game does not start its countdown.</p><p>{saved.visibility === 'personal' ? 'Your personal copy stays out of the shared library.' : 'This hunt is listed in the local preview library.'}</p><p>Game setup comes next; starting time and teams are confirmed there.</p><div className="editor-actions"><button className="primary-button" disabled={busy} onClick={() => { setBusy(true); void onGame(saved.id, 'schedule').finally(() => setBusy(false)) }}>Create Game</button><a className="outline-button" href="#/dev/hunts">Return to My Hunts</a></div></section>
  return <section className="hunt-editor">
    <div className="workspace-greeting"><div><div className="eyebrow">{initial ? 'EDIT YOUR REUSABLE HUNT' : 'BUILD YOUR NEXT ADVENTURE'}</div><h1>{initial ? 'Edit Hunt' : 'Create a Hunt'}</h1><p>{storageNotice} Unfinished drafts stay on this browser until you publish or save a personal hunt.</p></div></div>
    <nav className="editor-steps" aria-label="Hunt creation steps">{['Hunt details','Challenges','Paste a list','Review and save'].map((name, i) => <button key={name} type="button" aria-current={step === i ? 'step' : undefined} onClick={() => go(i)}><span>{i + 1}</span>{name}</button>)}</nav>
    {error && <div className="v12-error" role="alert">{error}</div>}
    <div className="v12-card editor-panel">
      {step === 0 && <><h2>Where will the adventure happen?</h2><div className="editor-fields"><label>Hunt title<input required maxLength={120} value={draft.title} onChange={e => change('title', e.target.value)}/></label><label>Venue<input required maxLength={160} value={draft.venue} onChange={e => change('venue', e.target.value)} placeholder="e.g. Hobby Lobby"/></label><label className="editor-wide">Description (optional)<textarea rows={2} maxLength={1000} value={draft.description} onChange={e => change('description', e.target.value)}/></label><label>Default duration (minutes)<input type="number" min={5} max={1440} value={draft.defaultDuration} onChange={e => change('defaultDuration', Number(e.target.value))}/></label><label>Sharing{initial?.visibility === 'personal' ? <p>Personal copy · only in My Hunts</p> : <select value={draft.visibility} onChange={e => change('visibility', e.target.value as HuntTemplate['visibility'])}><option value="public">Shared preview library</option><option value="personal">Personal hunt</option></select>}</label></div><h3>Suggested rules</h3><div className="editor-rules">{suggestions.map(rule => <label key={rule}><input type="checkbox" checked={draft.rules.includes(rule)} onChange={e => change('rules', e.target.checked ? [...draft.rules, rule] : draft.rules.filter(r => r !== rule))}/>{rule}</label>)}</div><label className="editor-label">All ground rules · one per line<textarea rows={3} value={draft.rules.join('\n')} onChange={e => change('rules', e.target.value.split('\n'))}/></label></>}
      {step === 1 && <><div className="editor-section-heading"><div><h2>Your photo challenges</h2><p>{draft.challenges.length} of 100 challenges · defaults to one point</p></div><button className="outline-button" disabled={draft.challenges.length >= 100} onClick={() => change('challenges', [...draft.challenges, { id: crypto.randomUUID(), title: '', description: '', points: 1 }])}><Plus size={16}/> Add challenge</button></div>
        {!draft.challenges.length && <p>Add a challenge, reuse an idea below, or continue to paste a list.</p>}
        <div className="editor-challenges">{draft.challenges.map((c, i) => <article key={c.id} className="editor-challenge"><div className="editor-challenge-number">{i + 1}</div><div className="editor-challenge-content"><label>Challenge {i + 1}<input maxLength={120} value={c.title} onChange={e => update(c.id, { title: e.target.value })}/></label><label>Instructions {i + 1} (optional)<textarea rows={2} maxLength={1000} value={c.description} onChange={e => update(c.id, { description: e.target.value })}/></label><label>Points {i + 1}<input type="number" min={0} max={1000} value={c.points} onChange={e => update(c.id, { points: Number(e.target.value) })}/></label></div><div className="editor-reorder"><button aria-label={`Move challenge ${i + 1} up`} disabled={i === 0} onClick={() => change('challenges', moveChallenge(draft.challenges, i, -1))}><ArrowUp size={16}/></button><button aria-label={`Move challenge ${i + 1} down`} disabled={i === draft.challenges.length - 1} onClick={() => change('challenges', moveChallenge(draft.challenges, i, 1))}><ArrowDown size={16}/></button><button aria-label={`Remove challenge ${i + 1}`} onClick={() => change('challenges', draft.challenges.filter(row => row.id !== c.id))}><Trash2 size={16}/></button></div></article>)}</div>
        <aside className="editor-idea-picker"><h3>Reuse a challenge idea</h3><label><Search size={16}/> Search challenge ideas<input type="search" value={search} onChange={e => setSearch(e.target.value)}/></label><div className="editor-ideas">{choices.map(c => <button key={c.id} disabled={draft.challenges.length >= 100} onClick={() => change('challenges', [...draft.challenges, { ...c, id: crypto.randomUUID(), points: 1 }])}><Plus size={14}/>{c.title}</button>)}</div>{!choices.length && <p>No matching ideas. Add your own challenge above.</p>}</aside></>}
      {step === 2 && <><h2>Paste a challenge list</h2><p>One challenge per line. Whitespace and blank lines are removed; your wording is preserved. Review and edit imported challenges before saving.</p><label className="editor-label">Challenge list<textarea rows={9} value={paste} onChange={e => setPaste(e.target.value)} placeholder={'Find something red\nFind a flamingo\nTake a team selfie'}/></label><label className="import-option"><input type="checkbox" checked={stripListMarkers} onChange={e => setStripListMarkers(e.target.checked)}/> Remove leading list bullets and numbering</label><button className="outline-button" onClick={() => { try { change('challenges', importChallenges(paste, draft.challenges, () => crypto.randomUUID(), stripListMarkers)); setPaste(''); setStep(1) } catch (err) { setError(err instanceof Error ? err.message : 'Could not import challenges.') } }}>Import and edit challenges</button><p>{draft.challenges.length} challenges already in this hunt. You can skip this step if your list is ready.</p></>}
      {step === 3 && <><h2>Review your hunt</h2><p>{draft.visibility === 'public' ? 'Publishing lists the challenge wording and rules in the shared preview library. Game invitations and photos are separate.' : 'Saving keeps this hunt personal and out of the shared library.'}</p><h3>{draft.title}</h3><p>{draft.venue} · {draft.defaultDuration} minutes · {draft.challenges.length} challenges · {draft.challenges.reduce((n,c) => n + c.points, 0)} available points</p><p>{draft.description}</p><span className="v12-tag">{draft.visibility === 'public' ? 'Shared preview library' : 'Personal hunt'}</span><h3>Ground rules</h3><ul>{draft.rules.filter(r => r.trim()).map((r,i) => <li key={i}>{r}</li>)}</ul><ol>{draft.challenges.map(c => <li key={c.id}><strong>{c.title}</strong> · {c.points} {c.points === 1 ? 'point' : 'points'}{c.description && <p>{c.description}</p>}</li>)}</ol></>}
    </div>
    <div className="editor-actions"><a className="outline-button" href="#/dev/hunts">Keep unfinished draft & close</a>{step > 0 && <button className="outline-button" onClick={() => go(step - 1)}>Back</button>}{step < 3 ? <button className="primary-button" onClick={() => go(step + 1)}>Continue</button> : <button className="primary-button" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : draft.visibility === 'public' ? 'Publish Hunt' : initial?.visibility === 'personal' ? 'Save Personal Copy' : 'Save Personal Hunt'}</button>}</div>
  </section>
}
