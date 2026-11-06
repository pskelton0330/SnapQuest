export function countNewMessages(previousIds: Iterable<string>, incoming: { id: string }[]) {
  const known = new Set(previousIds)
  return incoming.filter(message => !known.has(message.id)).length
}
