// blob-repository.js — the Blobs-backed repository (today's behavior). Used
// whenever DATABASE_URL is absent: every function keeps reading/writing Netlify
// Blobs exactly as before. `items`/`lookupCache` are intentionally absent here —
// collection.js talks to the Blob store directly and discogs.js/books.js keep
// their Blob caches until Part B. `feedback` is exposed as a LAZY facade (the
// runout-feedback store is opened on first use) so the future feedback.js
// function can switch backends transparently.

import * as blobUsers from './blob-users'
import { createFeedbackBlobStore } from '../feedback-blob'

// A lazy facade over the shared `runout-feedback` store. The underlying store
// is opened on the FIRST op, not when the repository is built — getStore()
// throws without Netlify env vars, and getRepository() must stay constructible
// in tests / local dev (no store is touched until an op actually runs). The op
// surface matches createFeedbackRepo's (feedback-repo.js), so the future
// feedback.js function can't tell which backend it's on.
function lazyFeedback() {
  let store = null
  const open = () => store || (store = createFeedbackBlobStore())
  return {
    createFeedback: (input) => open().createFeedback(input),
    listFeedback: (opts) => open().listFeedback(opts),
    updateFeedback: (id, patch) => open().updateFeedback(id, patch),
    deleteFeedback: (id) => open().deleteFeedback(id),
    deleteByAuthor: (authorId) => open().deleteByAuthor(authorId),
  }
}

export function createBlobRepository() {
  return {
    backend: 'blobs',
    feedback: lazyFeedback(),
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
