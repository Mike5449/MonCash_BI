import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { DatabaseZap, Check, X, Loader2 } from "lucide-react"
import { OpenAPI } from "../api/core/OpenAPI"

type State = "idle" | "loading" | "done" | "error"

/**
 * Clears BOTH cache layers:
 *  1. the server-side Databricks result cache (POST /cache/clear)
 *  2. the in-browser React Query cache (queryClient.clear())
 * so the next page load re-fetches fresh data from Databricks.
 */
export function ClearCacheButton() {
  const queryClient = useQueryClient()
  const [state, setState] = useState<State>("idle")
  const [message, setMessage] = useState<string>("")

  const handleClick = async () => {
    if (state === "loading") return
    setState("loading")
    setMessage("")
    try {
      const res = await fetch(`${OpenAPI.BASE}/cache/clear`, { method: "POST" })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json().catch(() => ({}))
      // Drop the browser cache too, then refetch any mounted queries.
      queryClient.clear()
      await queryClient.invalidateQueries()
      setState("done")
      setMessage(`Cache vidé (${data?.cleared_entries ?? 0} entrées serveur)`)
    } catch (e) {
      setState("error")
      setMessage(e instanceof Error ? e.message : "Échec")
    } finally {
      // Reset the icon after a short moment.
      window.setTimeout(() => setState("idle"), 2500)
    }
  }

  const icon =
    state === "loading" ? <Loader2 size={20} className="cache-spin" /> :
    state === "done" ? <Check size={20} color="#16a34a" /> :
    state === "error" ? <X size={20} color="#dc2626" /> :
    <DatabaseZap size={20} />

  const title =
    state === "loading" ? "Nettoyage du cache…" :
    message || "Vider le cache (données fraîches Databricks)"

  return (
    <button
      className="nav-action-btn"
      onClick={handleClick}
      disabled={state === "loading"}
      title={title}
      aria-label="Vider le cache"
    >
      {icon}
    </button>
  )
}
