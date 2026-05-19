export function nowIso(): string {
  return new Date().toISOString()
}

export function formatDurationSince(iso: string): string {
  const started = new Date(iso).getTime()
  const diff = Math.max(0, Date.now() - started)
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

export async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return
  await new Promise<void>(resolve => setTimeout(resolve, ms))
}
