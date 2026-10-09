// Frame fitting and mirroring.
//
// Two deliberate deviations from upstream src/App.tsx, both because we are producing a
// transmitted feed rather than a selfie preview:
//
//   1. Mirroring is optional and OFF by default. Upstream drawMirroredCover() mirrors
//      unconditionally (App.tsx:93-94), which is right for a preview and wrong for
//      transmission: Meet mirrors your self-view itself and sends unmirrored video, so
//      pre-mirroring would show every other participant a mirrored you.
//   2. The crop is computed separately from the draw, so the main thread can hand the
//      worker a pre-cropped ImageBitmap (GPU-side crop) instead of shipping full frames.
//
// The cover-crop arithmetic itself is copied verbatim from upstream.

/**
 * @returns {{sx:number,sy:number,sw:number,sh:number}}
 */
export function computeCoverCrop(sourceWidth, sourceHeight, targetWidth, targetHeight, zoom) {
  const sourceAspectRatio = sourceWidth / sourceHeight
  const targetAspectRatio = targetWidth / targetHeight

  let cropWidth = sourceWidth
  let cropHeight = sourceHeight

  if (sourceAspectRatio > targetAspectRatio) {
    cropWidth = sourceHeight * targetAspectRatio
  } else {
    cropHeight = sourceWidth / targetAspectRatio
  }

  cropWidth /= zoom
  cropHeight /= zoom

  return {
    sx: (sourceWidth - cropWidth) / 2,
    sy: (sourceHeight - cropHeight) / 2,
    sw: cropWidth,
    sh: cropHeight,
  }
}

/**
 * Draw an already-cropped source so that it fills the target box.
 * @param {CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D} context
 * @param {CanvasImageSource} source
 */
export function drawCover(context, source, targetWidth, targetHeight, mirror) {
  context.clearRect(0, 0, targetWidth, targetHeight)
  context.save()

  if (mirror) {
    context.translate(targetWidth, 0)
    context.scale(-1, 1)
  }

  context.drawImage(source, 0, 0, targetWidth, targetHeight)
  context.restore()
}
