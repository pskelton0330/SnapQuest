const baseUrl = process.env.DEPLOY_URL
const expectedCommit = process.env.EXPECTED_COMMIT

if (!baseUrl || !expectedCommit) {
  throw new Error('DEPLOY_URL and EXPECTED_COMMIT are required.')
}

const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
let lastError = 'The deployed build did not become available.'

for (let attempt = 1; attempt <= 12; attempt += 1) {
  try {
    const [pageResponse, manifestResponse] = await Promise.all([
      fetch(normalizedBaseUrl, { cache: 'no-store' }),
      fetch(new URL('build-info.json', normalizedBaseUrl), { cache: 'no-store' }),
    ])

    if (!pageResponse.ok) throw new Error(`Home page returned HTTP ${pageResponse.status}.`)
    if (!manifestResponse.ok) throw new Error(`Build manifest returned HTTP ${manifestResponse.status}.`)

    const html = await pageResponse.text()
    const manifest = await manifestResponse.json()
    if (!html.includes('id="root"')) throw new Error('Home page does not contain the application root.')
    if (manifest.commit !== expectedCommit) {
      throw new Error(`Served commit ${manifest.commit ?? 'unknown'}; expected ${expectedCommit}.`)
    }

    console.log(`Verified SnapQuest home page at ${normalizedBaseUrl} for commit ${expectedCommit}.`)
    process.exit(0)
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error)
    if (attempt < 12) await new Promise(resolve => setTimeout(resolve, 5000))
  }
}

throw new Error(`Deployment smoke check failed: ${lastError}`)
