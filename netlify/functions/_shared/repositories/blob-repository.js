// blob-repository.js — the Blobs-backed repository (today's behavior). Used
// whenever DATABASE_URL is absent: every function keeps reading/writing Netlify
// Blobs exactly as before. `items`/`lookupCache` are intentionally absent here —
// collection.js talks to the Blob store directly and discogs.js/books.js keep
// their Blob caches until Part B.

import * as blobUsers from './blob-users'

export function createBlobRepository() {
  return {
    backend: 'blobs',
    users: {
      listUsers: blobUsers.listUsers,
      getUser: blobUsers.getUser,
      saveUser: blobUsers.saveUser,
      removeUserRecord: blobUsers.removeUserRecord,
      findUserByCode: blobUsers.findUserByCode,
      findUserByStripeSession: blobUsers.findUserByStripeSession,
      findUserByStripeSubscription: blobUsers.findUserByStripeSubscription,
      listRequests: blobUsers.listRequests,
      getRequest: blobUsers.getRequest,
      saveRequest: blobUsers.saveRequest,
      removeRequest: blobUsers.removeRequest,
      findPendingRequestByEmail: blobUsers.findPendingRequestByEmail,
      findUserByEmail: blobUsers.findUserByEmail,
    },
    items: null,
    lookupCache: null,
  }
}
