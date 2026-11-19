import { readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const svg = await readFile(new URL('../public/snapquest-app-icon.svg', import.meta.url), 'utf8')
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 180, height: 180 }, deviceScaleFactor: 1 })
  await page.setContent(`<html><body style="margin:0;width:180px;height:180px">${svg}</body></html>`)
  const png = await page.locator('svg').screenshot({ type: 'png' })
  await writeFile(new URL('../public/apple-touch-icon.png', import.meta.url), png)
} finally {
  await browser.close()
}
