import { useEffect, useRef, useState } from 'react'
import QrScanner from 'qr-scanner'
import { Camera, CircleHelp, X } from 'lucide-react'

type QrInviteScannerProps = {
  onDetected: (value: string) => void
  onClose: () => void
}

export default function QrInviteScanner({ onDetected, onClose }: QrInviteScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const onDetectedRef = useRef(onDetected)
  const onCloseRef = useRef(onClose)
  const [error, setError] = useState('')
  const [starting, setStarting] = useState(true)

  onDetectedRef.current = onDetected
  onCloseRef.current = onClose

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    let mounted = true
    const scanner = new QrScanner(video, result => onDetectedRef.current(result.data), {
      preferredCamera: 'environment',
      highlightScanRegion: true,
      highlightCodeOutline: true,
      returnDetailedScanResult: true,
    })

    void scanner.start().then(() => {
      if (mounted) setStarting(false)
    }).catch(reason => {
      if (!mounted) return
      setStarting(false)
      const name = reason instanceof Error ? reason.name : ''
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setError('Camera access is blocked. Allow camera access for SnapQuest in your browser settings, then try again.')
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        setError('No camera was found on this device.')
      } else if (!window.isSecureContext) {
        setError('Camera scanning needs a secure connection. Open SnapQuest using its HTTPS address.')
      } else {
        setError('The camera could not start. Check your browser camera permission and try again.')
      }
    })

    return () => {
      mounted = false
      scanner.destroy()
    }
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onCloseRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return <div className="qr-scanner-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className="qr-scanner-dialog" role="dialog" aria-modal="true" aria-labelledby="qr-scanner-title">
      <header className="qr-scanner-header">
        <div><span className="qr-scanner-kicker"><Camera size={14}/> PLAYER CHECK-IN</span><h2 id="qr-scanner-title">Scan your team code</h2></div>
        <button type="button" className="qr-scanner-close" onClick={onClose} aria-label="Close QR scanner"><X size={21}/></button>
      </header>
      <p className="qr-scanner-copy">Allow camera access, then point your rear camera at the SnapQuest QR code from your organizer.</p>
      <div className="qr-scanner-view">
        <video ref={videoRef} muted playsInline aria-label="Live camera view for scanning a SnapQuest invitation QR code" />
        {!error && <div className="qr-scanner-frame" aria-hidden="true"><i/><i/><i/><i/></div>}
        {starting && !error && <div className="qr-scanner-status" role="status">Opening camera…</div>}
        {error && <div className="qr-scanner-error" role="alert"><CircleHelp size={21}/><p>{error}</p></div>}
      </div>
      <div className="qr-scanner-footer">
        <span>Keep the full code inside the frame.</span>
        <button type="button" className="outline-button" onClick={onClose}>Enter code instead</button>
      </div>
    </section>
  </div>
}
