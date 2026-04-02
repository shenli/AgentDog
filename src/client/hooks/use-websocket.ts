import { useEffect, useRef, useCallback } from "react"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"

type WSHandler = (payload: any) => void

/**
 * Hook that subscribes to Tauri backend events.
 * Replaces the WebSocket-based approach with native Tauri events.
 */
export function useWebSocket(_sessionId?: string | null) {
  const handlersRef = useRef<Map<string, WSHandler[]>>(new Map())
  const unlistenersRef = useRef<UnlistenFn[]>([])

  const on = useCallback((type: string, handler: WSHandler) => {
    if (!handlersRef.current.has(type)) {
      handlersRef.current.set(type, [])
    }
    handlersRef.current.get(type)!.push(handler)

    return () => {
      const handlers = handlersRef.current.get(type)
      if (handlers) {
        const idx = handlers.indexOf(handler)
        if (idx >= 0) handlers.splice(idx, 1)
      }
    }
  }, [])

  useEffect(() => {
    const eventTypes = [
      "turn",
      "tool_call",
      "anomaly",
      "session_discovered",
      "session_status_change",
      "context_snapshot",
      "rate_limit",
    ]

    const setupListeners = async () => {
      for (const eventType of eventTypes) {
        const unlisten = await listen(eventType, (event) => {
          const handlers = handlersRef.current.get(eventType)
          if (handlers) {
            for (const h of handlers) h(event.payload)
          }
          // Wildcard handlers
          const allHandlers = handlersRef.current.get("*")
          if (allHandlers) {
            for (const h of allHandlers) h({ type: eventType, ...(event.payload as Record<string, unknown>) })
          }
        })
        unlistenersRef.current.push(unlisten)
      }
    }

    setupListeners()

    return () => {
      for (const unlisten of unlistenersRef.current) {
        unlisten()
      }
      unlistenersRef.current = []
    }
  }, [])

  return { on, connected: true }
}
