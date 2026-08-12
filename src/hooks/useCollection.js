import { useCallback, useEffect, useState } from 'react'
import * as api from '../api/collection'
import * as apiLending from '../api/lending'

export function useCollection(collection = 'records') {
  const [items, setItems] = useState([])
  const [status, setStatus] = useState('loading') // loading | ready | error
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    setStatus('loading')
    try {
      const data = await api.listItems(collection)
      setItems(data)
      setStatus('ready')
    } catch (err) {
      setError(err.message)
      setStatus('error')
    }
  }, [collection])

  useEffect(() => { refresh() }, [refresh])

  const add = useCallback(async (item) => {
    const saved = await api.addItem(item, collection)
    setItems((prev) => [saved, ...prev])
    return saved
  }, [collection])

  const update = useCallback(async (id, patch) => {
    const prevItems = items
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)))
    try {
      await api.updateItem(id, patch, collection)
    } catch (err) {
      setItems(prevItems)
      throw err
    }
  }, [items, collection])

  const remove = useCallback(async (id) => {
    const prevItems = items
    setItems((prev) => prev.filter((it) => it.id !== id))
    try {
      await api.deleteItem(id, collection)
    } catch (err) {
      setItems(prevItems)
      throw err
    }
  }, [items, collection])

  // Optimistic lend: set item.lending immediately, revert + re-throw on failure.
  // The optimistic shape mirrors what the lending function stores (see
  // netlify/functions/lending.js handleLend) so the UI matches the server.
  // `payload` is { borrower: { name, contact? }, dueOn? }.
  const lend = useCallback(async (id, payload) => {
    const prevItems = items
    setItems((prev) =>
      prev.map((it) =>
        it.id === id
          ? {
              ...it,
              lending: {
                borrower: {
                  name: payload.borrower.name,
                  ...(payload.borrower.contact ? { contact: payload.borrower.contact } : {}),
                },
                lentOn: new Date().toISOString(),
                ...(payload.dueOn ? { dueOn: payload.dueOn } : {}),
              },
            }
          : it,
      ),
    )
    try {
      await apiLending.lend({ collection, itemId: id, borrower: payload.borrower, dueOn: payload.dueOn })
    } catch (err) {
      setItems(prevItems)
      throw err
    }
  }, [items, collection])

  // Optimistic return: clear item.lending and push the loan onto lendingHistory
  // immediately, revert + re-throw on failure. Cap matches the server's
  // HISTORY_CAP (netlify/functions/lending.js).
  const returnItem = useCallback(async (id) => {
    const prevItems = items
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it
        const updated = { ...it }
        if (it.lending) {
          const record = { ...it.lending, returnedOn: new Date().toISOString() }
          updated.lendingHistory = [record, ...(it.lendingHistory || [])].slice(0, 10)
        }
        delete updated.lending
        return updated
      }),
    )
    try {
      await apiLending.returnItem({ collection, itemId: id })
    } catch (err) {
      setItems(prevItems)
      throw err
    }
  }, [items, collection])

  return { items, status, error, refresh, add, update, remove, lend, returnItem }
}
