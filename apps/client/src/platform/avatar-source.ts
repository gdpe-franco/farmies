export const avatarFileSource = {
  accept: 'image/jpeg,image/png,image/webp',
  read: (event: Event) => (event.target as HTMLInputElement).files?.[0] ?? null,
}

export const avatarCameraSource = {
  open: () => {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('CAMERA_UNAVAILABLE')
    }
    return navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
    })
  },
  stop: (stream: MediaStream) => stream.getTracks().forEach((track) => track.stop()),
  capture: (video: HTMLVideoElement) => {
    if (!video.videoWidth || !video.videoHeight) throw new Error('CAMERA_NOT_READY')
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const context = canvas.getContext('2d')
    if (!context) throw new Error('CAMERA_UNAVAILABLE')
    context.drawImage(video, 0, 0)
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((photo) => photo ? resolve(photo) : reject(new Error('ENCODE_FAILED')), 'image/jpeg', 0.9)
    })
  },
}
