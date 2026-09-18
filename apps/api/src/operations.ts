import { deleteAccount } from './accounts.ts'
import { manageAvatar } from './avatars.ts'
import { findInvitePreview, manageInvite } from './invites.ts'
import {
  deleteParty,
  findTransferCandidates,
  joinParty,
  leaveParty,
  transferParty,
} from './memberships.ts'
import { createParty, findCurrentParty, findParties, findPartyById } from './parties.ts'
import { findScene } from './scene.ts'
import { findOrCreateUser, updateUserLocale } from './users.ts'

export const operations = {
  createParty,
  deleteAccount,
  deleteParty,
  findCurrentParty,
  findInvitePreview,
  findOrCreateUser,
  findParties,
  findPartyById,
  findScene,
  findTransferCandidates,
  joinParty,
  leaveParty,
  manageAvatar,
  manageInvite,
  transferParty,
  updateUserLocale,
}

export type Operations = typeof operations
