const SOURCE_SIZE_LIMIT = 20 * 1024 * 1024
const UPLOAD_SIZE_LIMIT = 8 * 1024 * 1024
const TARGET_SIZE = 800 * 1024

function decodeImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    const source = URL.createObjectURL(file)
    image.decoding = 'async'
    image.onload = () => { URL.revokeObjectURL(source); resolve(image) }
    image.onerror = () => { URL.revokeObjectURL(source); reject(new Error('This photo format could not be opened. Choose a JPEG, PNG, or WebP image.')) }
    image.src = source
  })
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('The photo could not be prepared. Try another image.')), 'image/jpeg', quality)
  })
}

/** Resize and re-encode a browser image before it reaches private storage. Canvas export removes EXIF metadata. */
export async function optimizePhoto(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file to upload.')
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'].includes(file.type.toLowerCase())) {
    throw new Error('Choose a JPEG, PNG, or WebP photo.')
  }
  if (file.size > SOURCE_SIZE_LIMIT) throw new Error('This photo is over 20 MB. Choose a smaller image.')

  const image = await decodeImage(file)
  if (!image.naturalWidth || !image.naturalHeight) throw new Error('The selected image is empty or damaged.')
  const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) throw new Error('Your browser could not prepare the photo. Try another browser or image.')
  context.drawImage(image, 0, 0, canvas.width, canvas.height)

  let blob: Blob | undefined
  for (const quality of [0.84, 0.76, 0.68, 0.58, 0.48]) {
    blob = await canvasBlob(canvas, quality)
    if (blob.size <= TARGET_SIZE || quality === 0.48) break
  }
  if (!blob || blob.size > UPLOAD_SIZE_LIMIT) throw new Error('This photo is still too large after compression. Choose a different image.')
  const baseName = file.name.replace(/\.[^.]+$/, '') || 'snapquest-photo'
  return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg', lastModified: Date.now() })
}
