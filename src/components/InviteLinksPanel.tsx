import { Check, Copy, ExternalLink, Link2 } from 'lucide-react'

type InviteCode = { team_id: string | null; team_name: string; invite_token: string }
type InviteLinksPanelProps = { invites: InviteCode[]; inviteUrl: (token: string) => string; copiedInvite: string; onCopy: (token: string) => void; onTest: (token: string) => void }

export default function InviteLinksPanel({ invites, inviteUrl, copiedInvite, onCopy, onTest }: InviteLinksPanelProps) {
  if (!invites.length) return null
  return <section className="invite-links-panel" aria-label="Team assignment links">
    <div className="invite-links-heading"><div><h2>Quick team links</h2><p>Copy a team link into a text message, or open it here to test the invitation.</p></div><Link2 size={18}/></div>
    <div className="invite-links-list">{invites.map(invite => <div className="invite-link-row" key={invite.invite_token}><span className="team-swatch"/><b>{invite.team_name}</b><input aria-label={`${invite.team_name} assignment link`} readOnly value={inviteUrl(invite.invite_token)}/><button className="outline-button" type="button" onClick={() => onCopy(invite.invite_token)}>{copiedInvite === invite.invite_token ? <><Check size={14}/> Copied</> : <><Copy size={14}/> Copy link</>}</button><button className="outline-button" type="button" onClick={() => onTest(invite.invite_token)}><ExternalLink size={14}/> Test</button></div>)}</div>
  </section>
}
