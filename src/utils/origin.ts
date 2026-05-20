export function formatOrigin(protocol: 'http' | 'https', host: string, port: number): string {
  const defaultPort = protocol === 'https' ? 443 : 80
  return port === defaultPort ? `${protocol}://${host}` : `${protocol}://${host}:${port}`
}
