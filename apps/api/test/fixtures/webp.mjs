// Structural fixture; browser coverage also validates real canvas-encoded images.
export const webp = () => {
  const bytes = new Uint8Array(32)
  const view = new DataView(bytes.buffer)
  const tag = (offset, value) => bytes.set(new TextEncoder().encode(value), offset)
  tag(0, 'RIFF'); view.setUint32(4, 24, true); tag(8, 'WEBP')
  tag(12, 'VP8 '); view.setUint32(16, 12, true)
  bytes.set([0x10, 0, 0, 0x9d, 1, 0x2a, 0, 2, 0, 2, 0, 0], 20)
  return bytes.buffer
}
