import { useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Check, Copy, ExternalLink, Link2, Maximize2, Printer, RefreshCw, UserRound, Users, X } from 'lucide-react'

type InviteCode = { team_id: string | null; team_name: string; invite_token: string }
type InviteLinksPanelProps = {
  invites: InviteCode[]
  inviteUrl: (token: string) => string
  copiedInvite: string
  assignmentMode: 'organizer' | 'balanced'
  busy?: boolean
  canReplace?: boolean
  onCopy: (token: string) => void
  onTest: (token: string) => void
  onJoinTeam: (token: string) => void
  onSeePlayers: () => void
  onReplaceCodes: () => void
  onPrint: () => void
}

export default function InviteLinksPanel({ invites, inviteUrl, copiedInvite, assignmentMode, busy = false, canReplace = false, onCopy, onTest, onJoinTeam, onSeePlayers, onReplaceCodes, onPrint }: InviteLinksPanelProps) {
  const [selectedToken, setSelectedToken] = useState(invites[0]?.invite_token ?? '')
  const fullScreenDialog = useRef<HTMLDialogElement>(null)
  const selectedInvite = invites.find(invite => invite.invite_token === selectedToken) ?? invites[0]

  if (!selectedInvite) return null

  const displayTeamName = assignmentMode === 'balanced' ? 'Shared team assignment' : selectedInvite.team_name
  const helperText = assignmentMode === 'balanced'
    ? 'Everyone scans this code. SnapQuest assigns each player to a team as they join.'
    : `Show this code to players joining ${selectedInvite.team_name}.`

  return <section className="invite-links-panel lobby-primary-invites" aria-labelledby="team-qr-heading">
    <div className="invite-links-heading">
      <div><span className="eyebrow">TEAM CHECK-IN</span><h2 id="team-qr-heading">Scan to join</h2><p>{helperText}</p></div>
      <Link2 size={18} aria-hidden="true"/>
    </div>

    {assignmentMode !== 'balanced' && invites.length > 1 && <label className="invite-team-picker">Team
      <select value={selectedInvite.invite_token} onChange={event => setSelectedToken(event.target.value)}>
        {invites.map(invite => <option key={invite.invite_token} value={invite.invite_token}>{invite.team_name}</option>)}
      </select>
    </label>}

    <div className="primary-invite-card">
      <h3>{displayTeamName}</h3>
      <div className="primary-invite-qr"><QRCodeSVG value={inviteUrl(selectedInvite.invite_token)} size={224} level="M" includeMargin/></div>
      <p className="primary-invite-caption">Point a phone camera at this code to open the team check-in.</p>
      <div className="primary-invite-actions">
        <button type="button" className="primary-button" onClick={() => onCopy(selectedInvite.invite_token)}>{copiedInvite === selectedInvite.invite_token ? <><Check size={16}/> Link copied</> : <><Copy size={16}/> Copy invite link</>}</button>
        <button type="button" className="outline-button" onClick={onSeePlayers}><Users size={16}/> See players</button>
        <button type="button" className="outline-button invite-full-screen" onClick={() => fullScreenDialog.current?.showModal()}><Maximize2 size={16}/> Full screen</button>
      </div>
    </div>

    <dialog className="invite-qr-dialog" ref={fullScreenDialog} aria-labelledby="fullscreen-team-qr-title">
      <div className="invite-qr-dialog-heading"><div><span className="eyebrow">TEAM CHECK-IN</span><h2 id="fullscreen-team-qr-title">{displayTeamName}</h2></div><button type="button" className="outline-button" aria-label="Close full-screen QR code" onClick={() => fullScreenDialog.current?.close()}><X size={18}/></button></div>
      <div className="primary-invite-qr"><QRCodeSVG value={inviteUrl(selectedInvite.invite_token)} size={288} level="M" includeMargin/></div>
      <p>Scan to join {assignmentMode === 'balanced' ? 'this hunt' : selectedInvite.team_name}.</p>
    </dialog>

    <details className="invite-secondary-tools">
      <summary>More invitation options</summary>
      <div className="invite-secondary-actions">
        <button type="button" className="outline-button" onClick={onPrint}><Printer size={15}/> Print team codes</button>
        <button type="button" className="outline-button" disabled={!canReplace || busy} onClick={onReplaceCodes}><RefreshCw size={15}/> {invites.length ? 'Replace team codes' : 'Create team codes'}</button>
      </div>
      <div className="invite-links-heading invite-secondary-heading"><div><h3>Quick team links</h3><p>Copy a link or open it to test a team invitation.</p></div></div>
      <div className="invite-links-list">{invites.map(invite => <div className="invite-link-row" key={invite.invite_token}><span className="team-swatch"/><b>{invite.team_name}</b><input aria-label={`${invite.team_name} assignment link`} readOnly value={inviteUrl(invite.invite_token)}/><div className="invite-link-actions"><button className="outline-button" type="button" onClick={() => onCopy(invite.invite_token)}>{copiedInvite === invite.invite_token ? <><Check size={14}/> Copied</> : <><Copy size={14}/> Copy link</>}</button><button className="outline-button" type="button" onClick={() => onTest(invite.invite_token)}><ExternalLink size={14}/> Test</button><button className="outline-button" type="button" onClick={() => onJoinTeam(invite.invite_token)}><UserRound size={14}/> Join as player</button></div></div>)}</div>
      <div className="invite-print-grid">{invites.map(invite => <article className="invite-print-card" key={invite.invite_token}><h2>{invite.team_name}</h2><QRCodeSVG value={inviteUrl(invite.invite_token)} size={184} level="M" includeMargin/><p>Scan to join {invite.team_name}</p></article>)}</div>
    </details>
  </section>
}
