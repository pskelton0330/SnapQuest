import { writeFile } from 'node:fs/promises'

const commit = process.env.BUILD_COMMIT
if (!commit || !/^[0-9a-f]{40}$/i.test(commit)) {
  throw new Error('BUILD_COMMIT must be a full Git commit SHA.')
}

await writeFile('dist/build-info.json', `${JSON.stringify({ commit })}\n`, 'utf8')
