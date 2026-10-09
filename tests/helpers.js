// Shared test scaffolding: a deterministic RNG and a CPU-only 2d context stand-in.

// mulberry32 -- small, fast, deterministic.
export function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Installs a seeded Math.random for the duration of `fn`.
export async function withSeededRandom(seed, fn) {
  const real = Math.random
  Math.random = mulberry32(seed)
  try {
    return await fn()
  } finally {
    Math.random = real
  }
}

// A 2d context stand-in that supports exactly what the filter code uses.
export function makeCtx(width, height, fill) {
  const backing = new Uint8ClampedArray(width * height * 4)
  if (fill) fill(backing, width, height)
  else {
    for (let i = 0; i < width * height; i++) {
      const x = i % width
      const y = (i / width) | 0
      backing[i * 4] = (x * 255) / width
      backing[i * 4 + 1] = (y * 255) / height
      backing[i * 4 + 2] = (x + y) % 256
      backing[i * 4 + 3] = 255
    }
  }

  return {
    _backing: backing,
    _log: [],
    getImageData(_x, _y, w, h) {
      this._log.push(['getImageData', w, h])
      return { data: backing.slice(), width: w, height: h }
    },
    putImageData(img) {
      this._log.push(['putImageData'])
      backing.set(img.data)
    },
    // The renderer's draw/clear surface (only used by renderer tests).
    clearRect() {},
    drawImage() {},
    save() {},
    restore() {},
    translate() {},
    scale() {},
    imageSmoothingEnabled: false,
  }
}

export function maxAbsDiff(a, b) {
  let max = 0
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i])
    if (d > max) max = d
  }
  return max
}
