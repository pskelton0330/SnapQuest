import { useEffect, useRef } from 'react'

export default function ConfirmDialog({ message, onCancel, onConfirm }: { message: string; onCancel: () => void; onConfirm: () => void }) {
  const container=useRef<HTMLDivElement>(null)
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null, overflow=document.body.style.overflow
    document.body.style.overflow='hidden'
    const element=container.current
    element?.querySelector<HTMLButtonElement>('button')?.focus()
    function handle(event:KeyboardEvent){
      if(event.key==='Escape'){event.preventDefault();onCancel()}
      if(event.key==='Tab'){
        const buttons=element?.querySelectorAll<HTMLButtonElement>('button')
        if(!buttons?.length)return
        if(event.shiftKey&&document.activeElement===buttons[0]){event.preventDefault();buttons[buttons.length-1].focus()}
        else if(!event.shiftKey&&document.activeElement===buttons[buttons.length-1]){event.preventDefault();buttons[0].focus()}
      }
    }
    document.addEventListener('keydown',handle)
    return()=>{document.removeEventListener('keydown',handle);document.body.style.overflow=overflow;previous?.focus()}
  },[onCancel])
  return <div className="game-confirm-overlay"><div className="v12-card game-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="game-confirm-title" aria-describedby="game-confirm-message" ref={container}><h2 id="game-confirm-title">Confirm game action</h2><p id="game-confirm-message">{message}</p><div className="editor-actions"><button className="outline-button" onClick={onCancel}>Cancel</button><button className="primary-button" onClick={onConfirm}>Confirm</button></div></div></div>
}
