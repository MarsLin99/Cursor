export async function fetchText(
  url: string,
  init: RequestInit = {},
  timeoutMs = 25000,
): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; MacroPulsePWA/1.0; +personal-use)',
        Accept: '*/*',
        ...(init.headers || {}),
      },
    })
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for ${url}`)
    }
    return await res.text()
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchJson<T>(
  url: string,
  init: RequestInit = {},
  timeoutMs = 25000,
): Promise<T> {
  const text = await fetchText(url, init, timeoutMs)
  return JSON.parse(text) as T
}
