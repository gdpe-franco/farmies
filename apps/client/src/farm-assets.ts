// Generated PNGs may bake a neutral checkerboard instead of an alpha channel.
// Remove only neutral pixels connected to the canvas edge; enclosed cream faces stay intact.
// This prepares a transient texture, leaving the generated source asset unchanged.
// ponytail: normalize the prototype matte per mount; use an authored RGBA atlas when the art pipeline is ready.
export const decodeCowAtlas = async (blob: Blob) => {
  const source = await createImageBitmap(blob, { resizeWidth: 1024, resizeHeight: 1024 })
  try {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1024
    const context = canvas.getContext('2d')!
    context.drawImage(source, 0, 0)
    const image = context.getImageData(0, 0, 1024, 1024)
    const queue = new Int32Array(1024 * 1024)
    let head = 0
    let tail = 0
    const visit = (pixel: number) => {
      const offset = pixel * 4
      const r = image.data[offset]!
      const g = image.data[offset + 1]!
      const b = image.data[offset + 2]!
      if (!image.data[offset + 3] || Math.min(r, g, b) < 150 || Math.max(r, g, b) - Math.min(r, g, b) > 6) return
      image.data[offset + 3] = 0
      queue[tail++] = pixel
    }
    for (let i = 0; i < 1024; i++) { visit(i); visit(1023 * 1024 + i); visit(i * 1024); visit(i * 1024 + 1023) }
    while (head < tail) {
      const pixel = queue[head++]!
      const x = pixel % 1024
      if (x) visit(pixel - 1)
      if (x < 1023) visit(pixel + 1)
      if (pixel >= 1024) visit(pixel - 1024)
      if (pixel < 1023 * 1024) visit(pixel + 1024)
    }
    // Each frame contains one connected cow. Drop matte speckles and neighboring-frame fragments.
    const labels = new Int32Array(256 * 256)
    for (let row = 0; row < 4; row++) for (let column = 0; column < 4; column++) {
      labels.fill(0)
      let component = 0, largest = 0, largestSize = 0
      const offset = (pixel: number) => ((row * 256 + Math.floor(pixel / 256)) * 1024 + column * 256 + pixel % 256) * 4
      const collect = (pixel: number) => {
        if (pixel < 0 || pixel >= labels.length || labels[pixel] || !image.data[offset(pixel) + 3]) return
        labels[pixel] = component
        queue[tail++] = pixel
      }
      for (let pixel = 0; pixel < labels.length; pixel++) {
        if (labels[pixel] || !image.data[offset(pixel) + 3]) continue
        component++
        head = tail = 0
        collect(pixel)
        while (head < tail) {
          const next = queue[head++]!, x = next % 256
          if (x) collect(next - 1)
          if (x < 255) collect(next + 1)
          collect(next - 256); collect(next + 256)
        }
        if (tail > largestSize) { largest = component; largestSize = tail }
      }
      for (let pixel = 0; pixel < labels.length; pixel++) {
        if (labels[pixel] !== largest) image.data[offset(pixel) + 3] = 0
      }
    }
    context.putImageData(image, 0, 0)
    return await createImageBitmap(canvas)
  } finally { source.close() }
}

// Seed inside each enclosed cream head, then follow its actual pixels, not a guessed ellipse.
// The resulting mask and bounds use the same frame coordinates as the body sprite.
export const decodeCowHeads = async (atlas: ImageBitmap) => {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 1024
  const context = canvas.getContext('2d')!
  context.drawImage(atlas, 0, 0)
  const pixels = context.getImageData(0, 0, 1024, 1024).data
  const seeds = [[80, 127], [83, 125], [80, 194], [78, 145]]
  const heads = []
  for (let row = 0; row < 4; row++) for (let column = 0; column < 4; column++) {
    const mask = context.createImageData(256, 256)
    const queue: number[] = []
    let left = 256, top = 256, right = 0, bottom = 0
    const visit = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= 256 || y >= 256) return
      const local = (y * 256 + x) * 4
      const offset = ((row * 256 + y) * 1024 + column * 256 + x) * 4
      const r = pixels[offset]!, g = pixels[offset + 1]!, b = pixels[offset + 2]!
      if (mask.data[local + 3] || !pixels[offset + 3] || Math.min(r, g, b) < 175 || r < g || g < b) return
      mask.data[local] = mask.data[local + 1] = mask.data[local + 2] = mask.data[local + 3] = 255
      queue.push(y * 256 + x)
      left = Math.min(left, x); right = Math.max(right, x)
      top = Math.min(top, y); bottom = Math.max(bottom, y)
    }
    visit(seeds[row]![0]!, seeds[row]![1]!)
    for (let i = 0; i < queue.length; i++) {
      const pixel = queue[i]!, x = pixel % 256, y = Math.floor(pixel / 256)
      visit(x - 1, y); visit(x + 1, y); visit(x, y - 1); visit(x, y + 1)
    }
    if (queue.length < 300 || right - left > 130 || bottom - top > 150) {
      heads.forEach(head => head.bitmap.close())
      throw new Error('COW_HEAD_MASK_INVALID')
    }
    // Fill enclosed shading/line pixels so the body artwork cannot show through an avatar.
    let centerX = 0, centerY = 0, count = 0
    for (let y = top; y <= bottom; y++) {
      let rowLeft = 256, rowRight = -1
      for (let x = left; x <= right; x++) if (mask.data[(y * 256 + x) * 4 + 3]) {
        rowLeft = Math.min(rowLeft, x); rowRight = x
      }
      for (let x = rowLeft; x <= rowRight; x++) {
        const local = (y * 256 + x) * 4
        mask.data[local] = mask.data[local + 1] = mask.data[local + 2] = mask.data[local + 3] = 255
        centerX += x; centerY += y; count++
      }
    }
    heads.push({ bitmap: await createImageBitmap(mask), x: left, y: top, width: right - left + 1, height: bottom - top + 1,
      centerX: centerX / count, centerY: centerY / count })
  }
  return heads
}
