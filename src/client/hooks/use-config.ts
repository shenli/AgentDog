import { useState, useEffect, useCallback } from "react"
import { api, type AppConfig } from "../lib/api"

export function useConfig() {
  const [config, setConfig] = useState<AppConfig>({ plan: "max", billing: {} })

  const refreshConfig = useCallback(() => {
    api.getConfig().then(setConfig).catch(() => {})
  }, [])

  useEffect(() => {
    refreshConfig()
  }, [refreshConfig])

  const setPlan = useCallback(async (plan: string) => {
    const updated = await api.setPlan(plan)
    setConfig(updated)
  }, [])

  return { config, setPlan, refreshConfig, isMax: config.plan === "max" }
}
