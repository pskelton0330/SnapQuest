export type CelebrationCardInput = {
  title: string
  venue?: string
  teamName: string
  teamColor: string
  score: number
  rank: number
  selfieUrl?: string
  tied?: boolean
}

const CARD_WIDTH = 1080
const CARD_HEIGHT = 1080

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height / 2)
  context.beginPath()
  context.moveTo(x + r, y)
  context.arcTo(x + width, y, x + width, y + height, r)
  context.arcTo(x + width, y + height, x, y + height, r)
  context.arcTo(x, y + height, x, y, r)
  context.arcTo(x, y, x + width, y, r)
  context.closePath()
}

function drawCover(context: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, width: number, height: number) {
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight)
  const sourceWidth = width / scale
  const sourceHeight = height / scale
  const sourceX = (image.naturalWidth - sourceWidth) / 2
  const sourceY = (image.naturalHeight - sourceHeight) / 2
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height)
}

async function loadImage(url: string) {
  const response = await fetch(url)
  if (!response.ok) throw new Error('The team selfie could not be loaded for the celebration card.')
  const image = new Image()
  const objectUrl = URL.createObjectURL(await response.blob())
  try {
    image.src = objectUrl
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('The team selfie could not be prepared for the celebration card.'))
    })
    return image
  } finally { URL.revokeObjectURL(objectUrl) }
}

function fitFontSize(context: CanvasRenderingContext2D, text: string, maxWidth: number, start: number, minimum: number) {
  for (let size = start; size > minimum; size -= 2) {
    context.font = `800 ${size}px Arial, sans-serif`
    if (context.measureText(text).width <= maxWidth) return size
  }
  return minimum
}

export function winnerCaption(input: Pick<CelebrationCardInput, 'title' | 'teamName' | 'score'> & { tied?: boolean }) {
  return input.tied
    ? `🏆 ${input.teamName} tied for first in ${input.title} with ${input.score} points! #SnapQuest`
    : `🏆 ${input.teamName} won ${input.title} with ${input.score} points! #SnapQuest`
}

export function celebrationFilename(teamName: string) {
  const safeName = teamName.trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'winner'
  return `snapquest-${safeName}-winner.png`
}

export async function renderWinnerCelebrationCard(input: CelebrationCardInput): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = CARD_WIDTH
  canvas.height = CARD_HEIGHT
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Celebration cards are not supported by this browser.')

  const color = input.teamColor || '#ef766f'
  const background = context.createLinearGradient(0, 0, CARD_WIDTH, CARD_HEIGHT)
  background.addColorStop(0, '#173f4c')
  background.addColorStop(0.58, '#206b6b')
  background.addColorStop(1, color)
  context.fillStyle = background
  context.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT)

  context.globalAlpha = 0.12
  context.fillStyle = '#ffffff'
  for (let i = -300; i < 1200; i += 180) {
    context.save()
    context.translate(i, 0)
    context.rotate(-Math.PI / 5)
    context.fillRect(0, 0, 34, 1500)
    context.restore()
  }
  context.globalAlpha = 1

  context.fillStyle = '#fff8e7'
  context.font = '800 34px Arial, sans-serif'
  context.fillText('SNAPQUEST', 70, 90)
  context.font = '700 24px Arial, sans-serif'
  context.fillStyle = '#bce8d9'
  context.fillText(input.tied ? 'TIED FOR FIRST' : 'WINNER CELEBRATION', 70, 135)

  const photoX = 70
  const photoY = 185
  const photoSize = 940
  context.save()
  roundedRect(context, photoX, photoY, photoSize, photoSize, 34)
  context.clip()
  if (input.selfieUrl) {
    try {
      const image = await loadImage(input.selfieUrl)
      drawCover(context, image, photoX, photoY, photoSize, photoSize)
    } catch {
      context.fillStyle = color
      context.fillRect(photoX, photoY, photoSize, photoSize)
    }
  } else {
    context.fillStyle = color
    context.fillRect(photoX, photoY, photoSize, photoSize)
  }
  context.fillStyle = 'rgb(0 0 0 / 30%)'
  context.fillRect(photoX, photoY + photoSize - 240, photoSize, 240)
  context.restore()

  context.textAlign = 'center'
  context.fillStyle = '#ffe28a'
  context.font = '120px Arial, sans-serif'
  context.fillText('🏆', CARD_WIDTH / 2, 850)
  context.fillStyle = '#ffffff'
  const nameSize = fitFontSize(context, input.teamName, 880, 66, 30)
  context.font = `800 ${nameSize}px Arial, sans-serif`
  context.fillText(input.teamName, CARD_WIDTH / 2, 935, 880)
  context.font = '700 30px Arial, sans-serif'
  context.fillStyle = '#fff8e7'
  context.fillText(`#${input.rank}  ·  ${input.score} POINTS`, CARD_WIDTH / 2, 985)
  const caption = input.venue ? `${input.title} · ${input.venue}` : input.title
  const captionSize = fitFontSize(context, caption, 900, 23, 16)
  context.font = `500 ${captionSize}px Arial, sans-serif`
  context.fillStyle = '#d7f2e8'
  context.fillText(caption, CARD_WIDTH / 2, 1030, 900)
  context.textAlign = 'start'

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('The celebration card could not be exported.')), 'image/png')
  })
}
