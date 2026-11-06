import { readFile, stat } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'

const html = await readFile('dist/index.html', 'utf8')
const entry = html.match(/<script[^>]+src="([^"]+\.js)"/i)?.[1]
if (!entry) throw new Error('Could not find the production JavaScript entry in dist/index.html')

const file = `dist/${entry.replace(/^\//, '')}`
const [bytes, info] = await Promise.all([readFile(file), stat(file)])
const compressedBytes = gzipSync(bytes).byteLength
const budgetBytes = 150 * 1024
console.log(`JavaScript entry: ${(info.size / 1024).toFixed(1)} KiB; gzip ${(compressedBytes / 1024).toFixed(1)} KiB; budget 150 KiB gzip`)
if (compressedBytes > budgetBytes) throw new Error('The initial JavaScript entry exceeds the gzip budget.')
