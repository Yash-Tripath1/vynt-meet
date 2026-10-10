// VYNT filter maths.
//
// Ported verbatim from Yash-Tripath1/Vynt src/App.tsx (applyPreset / applyFisheye
// / clamp / getEffectivePixelSize) at commit 50116b4. The per-pixel arithmetic is
// intentionally byte-for-byte identical to upstream so the extension looks exactly
// like the desktop app. Do not "improve" the constants here: visual parity is a
// feature, and tests/filters.test.js enforces it against the original.
//
// The one deliberate change is applyFisheye(), which uses a precomputed remap table.
// The remap depends only on (x, y, width, height) and never on pixel data, so it is
// frame-invariant. Caching it is arithmetically identical and ~4x faster. See
// fisheyeLut.js and tests/fisheyeLut.test.js, which proves equivalence.

export function clamp(value) {
  return Math.max(0, Math.min(255, value))
}

export function getEffectivePixelSize(pixelSize) {
  return 1 + Math.pow(pixelSize - 1, 1.45) * 0.22
}

/**
 * @param {CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D} context
 */
export function applyFisheye(context, width, height, lut) {
  const imageData = context.getImageData(0, 0, width, height)
  const source = new Uint8ClampedArray(imageData.data)
  const output = imageData.data

  if (!lut || lut.width !== width || lut.height !== height) {
    return applyFisheyeDirect(context, imageData, source, output, width, height)
  }

  const map = lut.map // Uint32Array of source pixel offsets; 0xFFFFFFFF = outside the lens
  for (let i = 0, p = 0; i < width * height; i += 1, p += 4) {
    const sourceIndex = map[i]
    if (sourceIndex === 0xffffffff) {
      output[p] = 8
      output[p + 1] = 8
      output[p + 2] = 7
      output[p + 3] = 255
      continue
    }
    output[p] = source[sourceIndex]
    output[p + 1] = source[sourceIndex + 1]
    output[p + 2] = source[sourceIndex + 2]
    output[p + 3] = 255
  }

  context.putImageData(imageData, 0, 0)
}

/** Original upstream implementation, kept as the correctness reference and fallback. */
function applyFisheyeDirect(context, imageData, source, output, width, height) {
  const centerX = width / 2
  const centerY = height / 2

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const outputIndex = (y * width + x) * 4
      const normalizedX = (x - centerX) / centerX
      const normalizedY = (y - centerY) / centerY
      const radius = Math.sqrt(normalizedX * normalizedX + normalizedY * normalizedY)

      if (radius > 1) {
        output[outputIndex] = 8
        output[outputIndex + 1] = 8
        output[outputIndex + 2] = 7
        output[outputIndex + 3] = 255
        continue
      }

      const sourceRadius = Math.pow(radius, 1.55)
      const angle = Math.atan2(normalizedY, normalizedX)
      const sourceX = Math.round(centerX + Math.cos(angle) * sourceRadius * centerX)
      const sourceY = Math.round(centerY + Math.sin(angle) * sourceRadius * centerY)
      const safeX = Math.max(0, Math.min(width - 1, sourceX))
      const safeY = Math.max(0, Math.min(height - 1, sourceY))
      const sourceIndex = (safeY * width + safeX) * 4

      output[outputIndex] = source[sourceIndex]
      output[outputIndex + 1] = source[sourceIndex + 1]
      output[outputIndex + 2] = source[sourceIndex + 2]
      output[outputIndex + 3] = 255
    }
  }

  context.putImageData(imageData, 0, 0)
}

/**
 * @param {CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D} context
 * @param {{width:number,height:number,map:Uint32Array}} [lut]
 */
export function applyPreset(context, width, height, filterMode, grain, lut) {
  if (filterMode === 'fisheye') {
    applyFisheye(context, width, height, lut)
  }

  if (filterMode === 'original' && grain === 0) {
    return
  }

  const imageData = context.getImageData(0, 0, width, height)
  const data = imageData.data
  const original = new Uint8ClampedArray(data)
  const manualGrain = grain * 0.28

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4
      const leftX = Math.max(0, x - 1)
      const rightX = Math.min(width - 1, x + 1)
      const leftIndex = (y * width + leftX) * 4
      const rightIndex = (y * width + rightX) * 4

      let red = original[index]
      let green = original[index + 1]
      let blue = original[index + 2]

      const luminance = red * 0.299 + green * 0.587 + blue * 0.114
      const normalizedX = (x - width / 2) / (width / 2)
      const normalizedY = (y - height / 2) / (height / 2)
      const distanceFromCenter = Math.sqrt(
        normalizedX * normalizedX + normalizedY * normalizedY
      )

      if (filterMode === 'vyntage') {
        red = red * 1.1 + 15
        green = green * 1.01 + 7
        blue = blue * 0.8 + 1

        red = luminance + (red - luminance) * 0.84
        green = luminance + (green - luminance) * 0.79
        blue = luminance + (blue - luminance) * 0.7

        red = (red - 128) * 0.87 + 138
        green = (green - 128) * 0.85 + 134
        blue = (blue - 128) * 0.82 + 127

        const noise = (Math.random() - 0.5) * (15 + manualGrain)
        red += noise * 1.1
        green += noise * 0.93
        blue += noise * 0.72

        const vignette = 1 - Math.max(0, distanceFromCenter - 0.2) * 0.2
        red *= vignette
        green *= vignette
        blue *= vignette
      }

      if (filterMode === 'digicam') {
        red = original[leftIndex]
        green = original[index + 1]
        blue = original[rightIndex + 2]

        red = red * 1.08 + 7
        green = green * 0.99 + 1
        blue = blue * 0.89 - 2

        red = (red - 128) * 1.07 + 128
        green = (green - 128) * 1.04 + 128
        blue = (blue - 128) * 1.01 + 128

        const noise = (Math.random() - 0.5) * (13 + manualGrain)
        red += noise * 1.05
        green += noise * 0.82
        blue += noise * 0.72

        const vignette = 1 - Math.max(0, distanceFromCenter - 0.34) * 0.26
        red *= vignette
        green *= vignette
        blue *= vignette

        const colourStep = 12
        red = Math.round(red / colourStep) * colourStep
        green = Math.round(green / colourStep) * colourStep
        blue = Math.round(blue / colourStep) * colourStep
      }

      if (filterMode === 'nightflash') {
        red = luminance * 1.18 + 24
        green = luminance * 1.1 + 14
        blue = luminance * 1.2 + 26

        const flashFalloff = 1 - Math.min(0.6, distanceFromCenter * 0.52)
        red *= flashFalloff
        green *= flashFalloff
        blue *= flashFalloff

        const noise = (Math.random() - 0.5) * (24 + manualGrain)
        red += noise
        green += noise * 0.85
        blue += noise * 1.22
      }

      if (filterMode === 'neoncity') {
        const splitX = Math.max(0, x - 2)
        const splitIndex = (y * width + splitX) * 4
        red = original[splitIndex] * 1.22 + 12
        green = green * 0.9 + 2
        blue = blue * 1.3 + 18
        const neonLuminance = red * 0.299 + green * 0.587 + blue * 0.114
        red = neonLuminance + (red - neonLuminance) * 1.38
        green = neonLuminance + (green - neonLuminance) * 1.04
        blue = neonLuminance + (blue - neonLuminance) * 1.46
        red = (red - 128) * 1.15 + 118
        green = (green - 128) * 1.18 + 110
        blue = (blue - 128) * 1.18 + 132
        const scanline = y % 4 < 2 ? 0.9 : 1.05
        const noise = (Math.random() - 0.5) * (10 + manualGrain)
        red = red * scanline + noise
        green = green * scanline + noise * 0.7
        blue = blue * scanline + noise * 1.2
      }

      if (filterMode === 'vhs') {
        const tapeLeftX = Math.max(0, x - 2)
        const tapeRightX = Math.min(width - 1, x + 2)
        const tapeLeftIndex = (y * width + tapeLeftX) * 4
        const tapeRightIndex = (y * width + tapeRightX) * 4

        red = original[tapeLeftIndex]
        green = original[index + 1]
        blue = original[tapeRightIndex + 2]

        const mutedLuminance = red * 0.299 + green * 0.587 + blue * 0.114
        red = mutedLuminance + (red - mutedLuminance) * 0.72 + 4
        green = mutedLuminance + (green - mutedLuminance) * 0.68
        blue = mutedLuminance + (blue - mutedLuminance) * 0.82 + 7

        const scanline = y % 4 < 2 ? 0.86 : 1
        red *= scanline
        green *= scanline
        blue *= scanline

        const noise = (Math.random() - 0.5) * (20 + manualGrain)
        red += noise
        green += noise
        blue += noise * 1.2
      }

      if (filterMode === 'goldenfilm') {
        red = red * 1.15 + 18
        green = green * 1.03 + 10
        blue = blue * 0.78 + 2

        red = (red - 128) * 0.88 + 135
        green = (green - 128) * 0.86 + 133
        blue = (blue - 128) * 0.84 + 128

        const noise = (Math.random() - 0.5) * (9 + manualGrain)
        red += noise
        green += noise * 0.9
        blue += noise * 0.7
      }

      if (filterMode === 'fisheye') {
        red = red * 1.04 + 4
        green = green * 1.01 + 2
        blue = blue * 1.06 + 5

        const noise = (Math.random() - 0.5) * (8 + manualGrain)
        red += noise
        green += noise
        blue += noise
      }

      if (filterMode === 'original' && grain > 0) {
        const noise = (Math.random() - 0.5) * manualGrain
        red += noise
        green += noise
        blue += noise
      }

      data[index] = clamp(red)
      data[index + 1] = clamp(green)
      data[index + 2] = clamp(blue)
      data[index + 3] = 255
    }
  }

  context.putImageData(imageData, 0, 0)
}

export function formatTimestamp(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const year = date.getFullYear()

  const rawHour = date.getHours()
  const hour = rawHour % 12 || 12
  const minute = String(date.getMinutes()).padStart(2, '0')
  const second = String(date.getSeconds()).padStart(2, '0')
  const meridiem = rawHour >= 12 ? 'PM' : 'AM'

  return `${month}-${day}-${year}   ${hour}:${minute}:${second} ${meridiem}`
}

export function drawTimestamp(context, width, height, timestamp, corner) {
  const text = formatTimestamp(timestamp)
  const fontSize = Math.max(13, Math.round(width * 0.022))
  const padding = Math.max(14, Math.round(width * 0.03))

  // Meet draws the participant's name over the BOTTOM-LEFT of every tile, which is exactly
  // where upstream VYNT stamps the date. So the default here is bottom-right; the corner is
  // configurable for anyone who wants the classic digicam look back.
  const c = corner || 'bottom-right'
  let x = padding
  let y = height - padding
  let align = 'left'
  let baseline = 'bottom'
  if (c === 'bottom-right') {
    x = width - padding
    align = 'right'
  } else if (c === 'top-left') {
    y = padding
    baseline = 'top'
  } else if (c === 'top-right') {
    x = width - padding
    y = padding
    align = 'right'
    baseline = 'top'
  }

  context.save()
  context.font = `bold ${fontSize}px "Courier New", monospace`
  context.textAlign = align
  context.textBaseline = baseline
  context.lineWidth = Math.max(2, Math.round(fontSize * 0.13))
  context.strokeStyle = 'rgba(10, 10, 9, 0.88)'
  context.fillStyle = 'rgba(239, 239, 228, 0.96)'
  context.strokeText(text, x, y)
  context.fillText(text, x, y)
  context.restore()
}
