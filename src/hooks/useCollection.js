import { useCallback, useEffect, useState } from 'react'
import * as api from '../api/collection'

export function useCollection() {
  const [items, setItems] = useState([])
  const [status, setStatus] = useState('loading') // loading | ready | error
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    setStatus('loading')
    try {
      const data = await api.listItems()
      setItems(data)
      setStatus('ready')
    } catch (err) {
      setError(err.message)
      setStatus('error')
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const add = useCallback(async (item) => {
    const saved = await api.addItem(item)
    setItems((prev) => [saved, ...prev])
    return saved
  }, [])

  const update = useCallback(async (id, patch) => {
    const prevItems = items
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)))
    try {
      await api.updateItem(id, patch)
    } catch (err) {
      setItems(prevItems)
      throw err
    }
  }, [items])

  const remove = useCallback(async (id) => {
    const prevItems = items
    setItems((prev) => prev.filter((it) => it.id !== id))
    try {
      await api.deleteItem(id)
    } catch (err) {
      setItems(prevItems)
      throw err
    }
  }, [items])

  return { items, status, error, refresh, add, update, remove }
}
