import { useState, useEffect, useCallback } from "react"
import { api, type AppConfig } from "../lib/api"

export function useConfig() {
  const [config, setConfig] = useState<AppConfig>({ plan: "max" })

  useEffect(() => {
    api.getConfig().then(setConfig).catch(() => {})
  }, [])

  const setPlan = useCallback(async (plan: string) => {
    const updated = await api.setPlan(plan)
    setConfig(updated)
  }, [])

  return { config, setPlan, isMax: config.plan === "max" }
}
