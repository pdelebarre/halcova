import { useCallback, useEffect, useState } from 'react'
import * as api from '../api/collection'

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
    const saved = await api.addItem(collection, item)
    setItems((prev) => [saved, ...prev])
    return saved
  }, [collection])

  const update = useCallback(async (id, patch) => {
    const prevItems = items
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)))
    try {
      await api.updateItem(collection, id, patch)
    } catch (err) {
      setItems(prevItems)
      throw err
    }
  }, [items, collection])

  const remove = useCallback(async (id) => {
    const prevItems = items
    setItems((prev) => prev.filter((it) => it.id !== id))
    try {
      await api.deleteItem(collection, id)
    } catch (err) {
      setItems(prevItems)
      throw err
    }
  }, [items, collection])

  return { items, status, error, refresh, add, update, remove }
}
