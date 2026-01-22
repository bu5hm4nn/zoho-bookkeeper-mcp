/**
 * Test setup file for Vitest
 */
import { vi } from "vitest"

// Mock File global for Node.js compatibility
if (typeof globalThis.File === "undefined") {
  globalThis.File = class File extends Blob {
    name: string
    lastModified: number

    constructor(fileBits: BlobPart[], fileName: string, options?: FilePropertyBag) {
      super(fileBits, options)
      this.name = fileName
      this.lastModified = options?.lastModified ?? Date.now()
    }
  } as unknown as typeof File
}

// Mock FormData if needed
if (typeof globalThis.FormData === "undefined") {
  globalThis.FormData = class FormData {
    private data = new Map<string, unknown>()

    append(name: string, value: unknown) {
      this.data.set(name, value)
    }

    get(name: string) {
      return this.data.get(name)
    }

    has(name: string) {
      return this.data.has(name)
    }

    delete(name: string) {
      this.data.delete(name)
    }

    entries() {
      return this.data.entries()
    }
  } as unknown as typeof FormData
}

// Mock fetch if not available (though it should be in Node 18+)
if (typeof globalThis.fetch === "undefined") {
  globalThis.fetch = vi.fn() as unknown as typeof fetch
}

// Ensure other web APIs are available
if (typeof globalThis.Headers === "undefined") {
  globalThis.Headers = class Headers {
    private headers = new Map<string, string>()

    constructor(init?: HeadersInit) {
      if (init) {
        if (Array.isArray(init)) {
          init.forEach(([key, value]) => this.headers.set(key.toLowerCase(), value))
        } else if (init instanceof Headers) {
          init.forEach((value, key) => this.headers.set(key, value))
        } else {
          Object.entries(init).forEach(([key, value]) => this.headers.set(key.toLowerCase(), value))
        }
      }
    }

    append(name: string, value: string) {
      this.headers.set(name.toLowerCase(), value)
    }

    delete(name: string) {
      this.headers.delete(name.toLowerCase())
    }

    get(name: string) {
      return this.headers.get(name.toLowerCase()) || null
    }

    has(name: string) {
      return this.headers.has(name.toLowerCase())
    }

    set(name: string, value: string) {
      this.headers.set(name.toLowerCase(), value)
    }

    forEach(callback: (value: string, key: string, parent: Headers) => void) {
      this.headers.forEach((value, key) => callback(value, key, this))
    }
  } as unknown as typeof Headers
}

if (typeof globalThis.Response === "undefined") {
  globalThis.Response = class Response {
    status: number
    statusText: string
    headers: Headers
    body: unknown
    ok: boolean

    constructor(body?: unknown, init?: ResponseInit) {
      this.body = body
      this.status = init?.status || 200
      this.statusText = init?.statusText || "OK"
      this.headers = new Headers(init?.headers)
      this.ok = this.status >= 200 && this.status < 300
    }

    async json() {
      return typeof this.body === "string" ? JSON.parse(this.body) : this.body
    }

    async text() {
      return typeof this.body === "string" ? this.body : JSON.stringify(this.body)
    }

    clone() {
      return new Response(this.body, {
        status: this.status,
        statusText: this.statusText,
        headers: this.headers,
      })
    }
  } as unknown as typeof Response
}
