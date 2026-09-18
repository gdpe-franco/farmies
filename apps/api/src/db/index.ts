import { drizzle } from 'drizzle-orm/postgres-js'
import type { Hyperdrive } from '@cloudflare/workers-types'
import postgres from 'postgres'

export const openDatabase = (bindings: { HYPERDRIVE: Hyperdrive }) => {
  const client = postgres(bindings.HYPERDRIVE.connectionString, {
    max: 1,
    fetch_types: false,
    prepare: true,
  })
  return { client, database: drizzle(client) }
}

type Database = ReturnType<typeof drizzle>

export const withDatabase = async <T>(
  bindings: { HYPERDRIVE: Hyperdrive },
  operation: (database: Database) => Promise<T>,
) => {
  const { client, database } = openDatabase(bindings)
  try {
    return await operation(database)
  } finally {
    await client.end()
  }
}
