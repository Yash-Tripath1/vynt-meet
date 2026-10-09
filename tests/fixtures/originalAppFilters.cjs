function clamp(value) {
  return Math.max(0, Math.min(255, value))
}
function getEffectivePixelSize(pixelSize) {
  return 1 + Math.pow(pixelSize - 1, 1.45) * 0.22
}
function applyFisheye(
  context,
  width,
  height
) {
  const imageData = context.getImageData(0, 0, width, height)
  const source = new Uint8ClampedArray(imageData.data)
  const output = imageData.data
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
function applyPreset(
  context,
  width,
  height,
  filterMode,
  grain
) {
  if (filterMode === 'fisheye') {
    applyFisheye(context, width, height)
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

module.exports={applyPreset,applyFisheye,clamp,getEffectivePixelSize};