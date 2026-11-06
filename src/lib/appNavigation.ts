export type AppSessionKind = { user: { is_anonymous?: boolean } } | null

export function shouldRouteToOrganizerWorkspace(session: AppSessionKind): boolean {
  return session !== null && !session.user.is_anonymous
}
