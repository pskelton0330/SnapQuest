import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { networkInterfaces } from 'node:os'

function localNetworkOrigin() {
  const addresses = Object.values(networkInterfaces()).flatMap(entries => entries ?? [])
  const address = addresses.find(entry => {
    if (entry.family !== 'IPv4' || entry.internal || entry.address.startsWith('169.254.')) return false
    return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(entry.address)
  })
  return address ? `http://${address.address}:5173` : ''
}

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: process.env.GITHUB_ACTIONS ? '/SnapQuest/' : '/',
  define: {
    'import.meta.env.VITE_LOCAL_NETWORK_ORIGIN': JSON.stringify(command === 'serve' ? localNetworkOrigin() : ''),
  },
}))
