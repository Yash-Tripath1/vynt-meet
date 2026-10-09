// Frame-invariant remap table for the fisheye filter.
//
// Upstream computes Math.pow / Math.atan2 / Math.cos / Math.sin / Math.round and two
// bounds clamps for every pixel of every frame. None of that depends on pixel data --
// only on (x, y, width, height). So we compute it once per output size and cache it.
// tests/fisheyeLut.test.js asserts the cached path is pixel-identical to the original.

const cache = new Map()

export function getFisheyeLut(width, height) {
  const key = `${width}x${height}`
  const cached = cache.get(key)
  if (cached) return cached

  const map = new Uint32Array(width * height)
  const centerX = width / 2
  const centerY = height / 2

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const normalizedX = (x - centerX) / centerX
      const normalizedY = (y - centerY) / centerY
      const radius = Math.sqrt(normalizedX * normalizedX + normalizedY * normalizedY)

      if (radius > 1) {
        map[y * width + x] = 0xffffffff
        continue
      }

      const sourceRadius = Math.pow(radius, 1.55)
      const angle = Math.atan2(normalizedY, normalizedX)
      const sourceX = Math.round(centerX + Math.cos(angle) * sourceRadius * centerX)
      const sourceY = Math.round(centerY + Math.sin(angle) * sourceRadius * centerY)
      const safeX = Math.max(0, Math.min(width - 1, sourceX))
      const safeY = Math.max(0, Math.min(height - 1, sourceY))

      map[y * width + x] = (safeY * width + safeX) * 4
    }
  }

  const lut = { width, height, map }
  // Cap the cache: the output size is stable during a call, but a device switch or an
  // aspect change must not grow this without bound.
  if (cache.size >= 8) cache.delete(cache.keys().next().value)
  cache.set(key, lut)
  return lut
}

export function clearFisheyeLutCache() {
  cache.clear()
}
