import { useEffect, useRef, useState } from 'react'

export default function ConfirmDialog({ message, title = 'Confirm game action', confirmLabel = 'Confirm', cancelLabel = 'Cancel', destructive = false, confirmationText, onCancel, onConfirm }: {
  message: string; title?: string; confirmLabel?: string; cancelLabel?: string; destructive?: boolean
  confirmationText?: string; onCancel: () => void; onConfirm: (confirmation: string) => void
}) {
  const [confirmation, setConfirmation] = useState('')
  const canConfirm = confirmationText === undefined || confirmation === confirmationText
  const container = useRef<HTMLDivElement>(null)
  const cancelRef = useRef(onCancel)
  useEffect(() => { cancelRef.current = onCancel }, [onCancel])

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const overflow = document.body.style.overflow
    const element = container.current
    document.body.style.overflow = 'hidden'

    const getFocusable = () => [...(element?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ) ?? [])].filter(item => item.getAttribute('aria-hidden') !== 'true' && item.getClientRects().length > 0)

    getFocusable()[0]?.focus()
    function handle(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        cancelRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = getFocusable()
      const first = focusable[0]
      const last = focusable.at(-1)
      if (!first || !last) {
        event.preventDefault()
        element?.focus()
      } else if (event.shiftKey && (document.activeElement === first || !element?.contains(document.activeElement))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !element?.contains(document.activeElement))) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handle)
    return () => {
      document.removeEventListener('keydown', handle)
      document.body.style.overflow = overflow
      previous?.focus()
    }
  }, [])

  return <div className="game-confirm-overlay">
    <div className="v12-card game-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="game-confirm-title" aria-describedby="game-confirm-message" ref={container} tabIndex={-1}>
      <h2 id="game-confirm-title">{title}</h2>
      <p id="game-confirm-message">{message}</p>
      <form onSubmit={event => { event.preventDefault(); if (canConfirm) onConfirm(confirmation) }}>
        {confirmationText !== undefined && <label className="game-confirm-input">Type the hunt name to confirm
          <input value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off"/>
        </label>}
        <div className="editor-actions">
          <button type="button" className="outline-button" onClick={onCancel}>{cancelLabel}</button>
          <button type="submit" disabled={!canConfirm} className={destructive ? 'reject-button' : 'primary-button'}>{confirmLabel}</button>
        </div>
      </form>
    </div>
  </div>
}
