import { Camera, Compass, ClipboardList, CalendarDays, Plus, ArrowLeft } from 'lucide-react'
import type { WorkspaceRoute } from '../lib/workspace'

export default function WorkspaceNavigation({ route }: { route: WorkspaceRoute }) {
  return <aside className="workspace-sidebar">
    <a className="workspace-brand" href="#/dev/browse"><span><Camera size={19}/></span> SnapQuest</a>
    <div className="workspace-section-label">YOUR ADVENTURES</div>
    {([{ page: 'browse', name: 'Browse Hunts', icon: Compass }, { page: 'hunts', name: 'My Hunts', icon: ClipboardList }, { page: 'games', name: 'My Games', icon: CalendarDays }, { page: 'create', name: 'Create a Hunt', icon: Plus }] as const).map(({ page, name, icon: Icon }) => <a className={`side-link ${route.page === page ? 'selected' : ''}`} href={`#/dev/${page}`} aria-current={route.page === page ? 'page' : undefined} key={page}><Icon size={17}/>{name}</a>)}
    <div className="sidebar-bottom"><a className="side-link" href="#"><ArrowLeft size={16}/> Home</a></div>
  </aside>
}
