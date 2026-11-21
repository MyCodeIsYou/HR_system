const SHELL = "hr-shell-v1"

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then(async (cache) => {
        try {
          await cache.add(new URL("index.html", self.registration.scope))
        } catch {
          // The first successful page load fills the shell.
        }
        await self.skipWaiting()
      }),
  )
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== SHELL).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener("fetch", (event) => {
  const request = event.request
  if (request.method !== "GET") return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (request.mode === "navigate") {
    event.respondWith(networkThenShell(request))
    return
  }

  if (url.pathname.includes("/assets/")) {
    event.respondWith(cacheFirst(request))
  }
})

async function networkThenShell(request) {
  const shellUrl = new URL("index.html", self.registration.scope)
  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(SHELL)
      await cache.put(shellUrl, response.clone())
      return response
    }
    const cached = await caches.match(shellUrl)
    if (response.status === 404 && cached) return cached
    return response
  } catch (error) {
    const cached = await caches.match(shellUrl)
    if (cached) return cached
    throw error
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response.ok) {
    const cache = await caches.open(SHELL)
    await cache.put(request, response.clone())
  }
  return response
}
