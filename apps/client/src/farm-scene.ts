import { z } from 'zod'

export const sceneSchema = z.object({
  party: z.object({ id: z.string().regex(/^\d+$/), species: z.literal('COW'),
    environment: z.object({ code: z.literal('PASTURE'), definition: z.object({
      version: z.literal(1), scene: z.literal('PASTURE'),
      zones: z.array(z.never()), props: z.array(z.never()), capabilities: z.array(z.never()),
    }).strict() }),
  }),
  members: z.array(z.object({ membershipId: z.string().regex(/^\d+$/), nickname: z.string().min(1).max(40),
    joinedAt: z.iso.datetime(), avatarVersion: z.number().int().positive().nullable(),
  })).min(1).max(10),
})
export type SceneData = z.infer<typeof sceneSchema>
export const activities = ['idle', 'walking', 'grazing', 'eating', 'sleeping'] as const
export type Activity = typeof activities[number]
export const bucketDuration = 30_000

export const stableSeed = (value: string) => {
  let hash = 2166136261
  for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619)
  return hash >>> 0
}

export const activityAt = (partyId: string, member: SceneData['members'][number], now: number): Activity =>
  activities[(stableSeed(`${partyId}:${member.membershipId}:${member.joinedAt}`) + Math.floor(now / bucketDuration)) % activities.length]!

export const sceneLayout = (width: number, count: number) => {
  const columns = width < 480 ? 2 : width < 720 ? 3 : 5
  const rows = Math.ceil(count / columns)
  const cellWidth = width / columns
  const cellHeight = Math.min(100, cellWidth * 0.7)
  return { columns, height: Math.max(440, 210 + rows * cellHeight), cellWidth, cellHeight }
}

export const coverTransform = (sourceWidth: number, sourceHeight: number, width: number, height: number) => {
  const scale = Math.max(width / sourceWidth, height / sourceHeight)
  return { scale, x: (width - sourceWidth * scale) / 2, y: (height - sourceHeight * scale) / 2 }
}

// Stable private membership order supplies separated patches; jitter breaks the display-grid feel.
export const pasturePosition = (width: number, count: number, index: number, membershipId: string) => {
  const layout = sceneLayout(width, count)
  const seed = stableSeed(membershipId)
  const scale = Math.min(0.38, layout.cellWidth / 350)
  const margin = 115 * scale + 14
  return {
    x: Math.max(margin, Math.min(width - margin, layout.cellWidth * (index % layout.columns + 0.5) + ((seed % 11) - 5) * layout.cellWidth * 0.02)),
    y: 200 + Math.floor(index / layout.columns) * layout.cellHeight + ((seed >>> 8) % 9 - 4) * 3,
    scale,
  }
}
