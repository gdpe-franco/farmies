import { AnimatedSprite, Application, Container, Graphics, Rectangle, Sprite, Text, Texture } from 'pixi.js'
import pastureUrl from './assets/farm/pasture.png'
import cowUrl from './assets/farm/cow-atlas.png'
import { decodeCowAtlas, decodeCowHeads } from './farm-assets'
import { activityAt, coverTransform, pasturePosition, sceneLayout, stableSeed, type Activity, type SceneData } from './farm-scene'

const cowRows: Record<Activity, number> = { idle: 0, walking: 1, grazing: 2, eating: 2, sleeping: 3 }

// Renderer objects and animation mapping stay outside Vue and API contracts.
export const createFarmRenderer = async (
  host: HTMLElement, scene: SceneData, faces: Map<string, ImageBitmap>,
  colors: { pasture: string; sky: string; ink: string; coat: string; blush: string },
  now: () => number,
) => {
  const app = new Application()
  const bitmaps: ImageBitmap[] = []
  const textures: Texture[] = []
  let observer: ResizeObserver | undefined
  const visibility = () => { if (document.hidden) app.stop(); else app.start() }
  const cleanup = () => {
    observer?.disconnect()
    document.removeEventListener('visibilitychange', visibility)
    if (app.renderer) app.destroy(true, { children: true })
    textures.forEach(texture => texture.destroy(true))
    bitmaps.forEach(bitmap => bitmap.close())
  }
  try {
    const load = async (url: string, size: number) => {
      const response = await fetch(url)
      if (!response.ok) throw new Error('SCENE_ASSET_LOAD_FAILED')
      const blob = await response.blob()
      const bitmap = url === cowUrl ? await decodeCowAtlas(blob) : await createImageBitmap(blob, { resizeWidth: size })
      bitmaps.push(bitmap)
      const texture = Texture.from(bitmap)
      texture.source.scaleMode = 'nearest'
      textures.push(texture)
      return texture
    }
    // Owned textures prevent a global cache retaining private image sources.
    const background = await load(pastureUrl, 768)
    const atlas = await load(cowUrl, 1024)
    const heads = await decodeCowHeads(bitmaps[1]!)
    const headMasks = heads.map(head => {
      bitmaps.push(head.bitmap)
      const texture = Texture.from(head.bitmap)
      texture.source.scaleMode = 'nearest'
      textures.push(texture)
      return texture
    })
    await app.init({ width: Math.max(160, host.clientWidth), height: 300, background: colors.sky,
      resolution: 1, autoDensity: true, preference: 'webgl', powerPreference: 'low-power', antialias: false,
    })
    host.appendChild(app.canvas)
    app.canvas.setAttribute('aria-hidden', 'true')
    app.ticker.maxFPS = 30
    const world = new Container()
    app.stage.addChild(world)
    const backdrop = new Sprite(background)
    world.addChild(backdrop)
    const grass = Array.from({ length: 12 }, (_, i) => {
      const tuft = new Graphics().rect(-3, -8, 3, 8).rect(1, -12, 3, 12).rect(5, -6, 3, 6).fill(colors.pasture)
      tuft.alpha = 0.65
      world.addChild(tuft)
      return { tuft, seed: stableSeed(`grass:${i}`) }
    })
    const rows = Array.from({ length: 4 }, (_, row) => Array.from({ length: 4 }, (_, column) =>
      new Texture({ source: atlas.source, frame: new Rectangle(column * 256, row * 256, 256, 256) })))
    const cows = scene.members.map(member => {
      const animal = new Container()
      const body = new AnimatedSprite(rows[0]!)
      body.anchor.set(0.5, 0.9)
      body.autoUpdate = false
      animal.addChild(body)
      const face = new Container()
      const mask = new Sprite(headMasks[0]!)
      mask.position.set(-128, -256 * 0.9)
      let photo: Sprite | undefined
      let placeholderEyes: Graphics | undefined
      const bitmap = faces.get(member.membershipId)
      if (bitmap) {
        const texture = Texture.from(bitmap)
        texture.source.scaleMode = 'linear'
        textures.push(texture)
        face.addChild(new Graphics().rect(-50, -50, 100, 100).fill(colors.coat))
        photo = new Sprite(texture)
        photo.anchor.set(0.5)
        photo.width = photo.height = 106
        face.addChild(photo)
      } else {
        placeholderEyes = new Graphics().rect(-20, -15, 6, 8).rect(14, -15, 6, 8).fill(0x34363a)
        const muzzle = new Graphics().poly([-20, 12, 20, 12, 20, 16, 25, 16, 25, 29, 20, 29, 20, 33,
          -20, 33, -20, 29, -25, 29, -25, 16, -20, 16]).fill(colors.blush)
          .rect(-12, 21, 5, 4).rect(7, 21, 5, 4).fill(0x45474b)
        muzzle.x = -8
        face.addChild(placeholderEyes, muzzle)
      }
      const sleepEyes = new Graphics().rect(-22, -10, 12, 4).rect(10, -10, 12, 4).fill(0x34363a)
      face.addChild(sleepEyes)
      animal.addChild(face, mask)
      face.mask = mask
      const label = new Container()
      const name = new Text({ text: member.nickname, style: { fontFamily: 'system-ui', fontSize: 11, fill: colors.ink } })
      name.anchor.set(0.5)
      name.position.set(0, 15)
      const chip = new Graphics()
      label.addChild(chip, name)
      const sleep = new Text({ text: 'z', style: { fontFamily: 'system-ui', fontSize: 13, fill: colors.ink } })
      sleep.position.set(16, -65)
      animal.addChild(sleep)
      world.addChild(animal, label)
      return { animal, body, face, photo, mask, placeholderEyes, sleepEyes, sleep, label, name, chip, member,
        x: 0, y: 0, row: 0, scale: 1, direction: stableSeed(member.membershipId) % 2 ? 1 : -1 }
    })
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const resize = () => {
      const width = Math.max(160, host.clientWidth)
      const layout = sceneLayout(width, cows.length)
      app.renderer.resize(width, layout.height)
      const backgroundTransform = coverTransform(background.width, background.height, width, layout.height)
      backdrop.scale.set(backgroundTransform.scale)
      backdrop.position.set(backgroundTransform.x, backgroundTransform.y)
      grass.forEach(({ tuft, seed }) => tuft.position.set(16 + seed % Math.max(1, Math.floor(width - 32)), 140 + seed % Math.max(1, Math.floor(layout.height - 155))))
      cows.forEach((entry, index) => {
        const position = pasturePosition(width, cows.length, index, entry.member.membershipId)
        entry.x = position.x
        entry.y = position.y
        entry.scale = position.scale
        entry.animal.scale.set(entry.scale)
        entry.name.scale.set(1)
        entry.name.scale.set(Math.min(1, (layout.cellWidth - 14) / Math.max(entry.name.width, 1)))
        const chipWidth = Math.min(layout.cellWidth - 8, Math.max(50, entry.name.width + 12))
        entry.chip.clear().roundRect(-chipWidth / 2, 6, chipWidth, 18, 6).fill({ color: colors.sky, alpha: 0.9 })
      })
    }
    const animate = () => {
      const time = now()
      grass.forEach(({ tuft, seed }) => { tuft.skew.x = motion.matches ? 0 : Math.sin(time / 2600 + seed) * 0.12 })
      cows.forEach(entry => {
        const state = activityAt(scene.party.id, entry.member, time)
        const row = cowRows[state]
        const seed = stableSeed(entry.member.membershipId)
        const seconds = time / 1000 + seed % 23
        const moving = !motion.matches
        const speed = state === 'walking' ? 5 : state === 'grazing' || state === 'eating' ? 3 : 1.5
        const frame = moving ? Math.floor(seconds * speed) % 4 : 0
        if (entry.row !== row) { entry.body.textures = rows[row]!; entry.row = row }
        entry.body.gotoAndStop(frame)
        const head = heads[row * 4 + frame]!
        entry.face.position.set(head.centerX - 128, head.centerY - 256 * 0.9)
        entry.face.scale.set(head.width / 100, head.height / 100)
        // Photos replace the entire face: center on the mask bounds and overscan slightly so
        // no coat backing can appear as a detached muzzle at any pose or facing direction.
        entry.photo?.position.set((head.x + head.width / 2 - head.centerX) * 100 / head.width,
          (head.y + head.height / 2 - head.centerY) * 100 / head.height)
        entry.mask.texture = headMasks[row * 4 + frame]!
        const blinking = moving && seconds % 7 > 6.8
        if (entry.placeholderEyes) entry.placeholderEyes.visible = state !== 'sleeping' && !blinking
        entry.sleepEyes.visible = !!entry.placeholderEyes && (state === 'sleeping' || blinking)
        entry.sleep.visible = state === 'sleeping'
        const walk = moving && state === 'walking' ? Math.sin(seconds / 3) * 14 : 0
        if (moving && state === 'walking') entry.direction = Math.cos(seconds / 3) > 0 ? -1 : 1
        const breathing = moving ? Math.sin(seconds * 1.7) * 0.008 : 0
        entry.animal.position.set(entry.x + walk, entry.y)
        entry.animal.scale.set(entry.direction * entry.scale, entry.scale * (1 + breathing))
        entry.sleep.scale.x = entry.direction
        entry.label.position.set(entry.x + walk, entry.y)
        entry.sleep.alpha = moving ? 0.5 + Math.sin(seconds) * 0.25 : 0.75
      })
    }
    observer = new ResizeObserver(resize)
    observer.observe(host)
    document.addEventListener('visibilitychange', visibility)
    resize()
    animate()
    app.ticker.add(animate)
    visibility()
    return cleanup
  } catch (error) { cleanup(); throw error }
}
