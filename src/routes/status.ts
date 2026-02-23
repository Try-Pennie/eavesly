import { Hono } from "hono"
import type { AppEnv } from "../types/env"
import { auth } from "../middleware/auth"

const statusRoutes = new Hono<AppEnv>()
statusRoutes.use("*", auth)

statusRoutes.get("/status/:instanceId", async (c) => {
  const instanceId = c.req.param("instanceId")
  const instance = await c.env.EVALUATION_WORKFLOW.get(instanceId)
  const status = await instance.status()
  return c.json({ instanceId, ...status })
})

export { statusRoutes }
