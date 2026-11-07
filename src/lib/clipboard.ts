/** Copy text in browsers that reject the async clipboard API as well as modern browsers. */
export async function copyTextToClipboard(text: string) {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Async clipboard is unavailable.')
    await navigator.clipboard.writeText(text)
    return
  } catch {
    const field = document.createElement('textarea')
    field.value = text
    field.setAttribute('readonly', '')
    field.setAttribute('aria-hidden', 'true')
    field.style.position = 'fixed'
    field.style.left = '-9999px'
    document.body.append(field)
    field.select()
    const copied = document.execCommand('copy')
    field.remove()
    if (!copied) throw new Error('Clipboard access is unavailable.')
  }
}
