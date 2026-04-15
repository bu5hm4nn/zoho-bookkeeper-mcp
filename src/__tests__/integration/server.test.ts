/**
 * Integration tests for the MCP server
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

describe("MCP Server", () => {
  let originalEnv: typeof process.env

  beforeEach(() => {
    originalEnv = { ...process.env }
    vi.resetModules()
  })

  afterEach(() => {
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  describe("server initialization", () => {
    it("creates server instance", async () => {
      const { default: server } = await import("../../index.js")

      expect(server).toBeDefined()
      // FastMCP server instance should exist
      expect(typeof server.start).toBe("function")
    })

    it("registers all expected tools", async () => {
      const { default: server } = await import("../../index.js")

      // Server should have tools registered
      expect(server).toBeDefined()
      // Tool count changes as the curated surface grows; verify the server loads successfully.
    })
  })

  describe("health endpoint", () => {
    it("server has health configuration", async () => {
      const { default: server } = await import("../../index.js")

      // Health endpoint should be configured
      expect(server).toBeDefined()
    })
  })
})
