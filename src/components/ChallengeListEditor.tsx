import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react'
import { moveItem } from '../lib/huntEditor'
import type { Challenge } from '../lib/workspace'

type Props = {
  items: Challenge[]
  variant: 'production' | 'reusable'
  onChange: (items: Challenge[]) => void
}

export default function ChallengeListEditor({ items, variant, onChange }: Props) {
  const production = variant === 'production'
  return <div className={production ? 'draft-item-list' : 'editor-challenges'}>
    {items.map((item, index) => <article key={item.id} className={production ? 'draft-item' : 'editor-challenge'}>
      <div className={production ? 'draft-item-number' : 'editor-challenge-number'}>{index + 1}</div>
      <div className={production ? 'draft-item-fields' : 'editor-challenge-content'}>
        <label>{production ? 'What should they find?' : `Challenge ${index + 1}`}<input maxLength={120} value={item.title} onChange={event => onChange(items.map((current, i) => i === index ? { ...current, title: event.target.value } : current))} placeholder={production ? 'e.g. A colorful sign' : undefined}/></label>
        <label>{production ? <>Instructions <span className="optional">Optional</span></> : `Instructions ${index + 1} (optional)`}{production
          ? <input maxLength={1000} value={item.description} onChange={event => onChange(items.map((current, i) => i === index ? { ...current, description: event.target.value } : current))} placeholder="Add a clue or photo idea"/>
          : <textarea rows={2} maxLength={1000} value={item.description} onChange={event => onChange(items.map((current, i) => i === index ? { ...current, description: event.target.value } : current))}/>}</label>
        <label className={production ? 'points-field' : undefined}>{production ? 'Points' : `Points ${index + 1}`}<input type="number" min={0} max={1000} value={item.points} onChange={event => onChange(items.map((current, i) => i === index ? { ...current, points: Number(event.target.value) } : current))}/></label>
      </div>
      {production ? <><div className="draft-item-reorder"><button type="button" className="icon-button" aria-label={`Move item ${index + 1} up`} disabled={index === 0} onClick={() => onChange(moveItem(items, index, -1))}><ArrowUp size={14}/></button><button type="button" className="icon-button" aria-label={`Move item ${index + 1} down`} disabled={index === items.length - 1} onClick={() => onChange(moveItem(items, index, 1))}><ArrowDown size={14}/></button></div><button type="button" aria-label={`Remove item ${index + 1}`} className="icon-button remove-item" onClick={() => onChange(items.filter((_, i) => i !== index))}><Trash2 size={16}/></button></>
        : <div className="editor-reorder"><button type="button" aria-label={`Move challenge ${index + 1} up`} disabled={index === 0} onClick={() => onChange(moveItem(items, index, -1))}><ArrowUp size={16}/></button><button type="button" aria-label={`Move challenge ${index + 1} down`} disabled={index === items.length - 1} onClick={() => onChange(moveItem(items, index, 1))}><ArrowDown size={16}/></button><button type="button" aria-label={`Remove challenge ${index + 1}`} onClick={() => onChange(items.filter((_, i) => i !== index))}><Trash2 size={16}/></button></div>}
    </article>)}
  </div>
}
