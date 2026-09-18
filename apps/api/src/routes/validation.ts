import { z } from 'zod'

export const bigintIdSchema = z.string().regex(/^[1-9]\d{0,18}$/).refine(
  (value) => BigInt(value) <= 9_223_372_036_854_775_807n,
)
