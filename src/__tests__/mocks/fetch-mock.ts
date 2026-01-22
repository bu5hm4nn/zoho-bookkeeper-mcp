/**
 * Fetch mock utilities for testing
 */
import { vi, type Mock } from "vitest"
import {
  oauthTokenResponse,
  oauthErrorResponse,
  notFoundErrorResponse,
  authErrorResponse,
  rateLimitErrorResponse,
} from "../fixtures/zoho-responses.js"

export interface MockResponse {
  ok: boolean
  status: number
  statusText: string
  body?: unknown
  headers?: Record<string, string>
}

export interface FetchMockConfig {
  defaultResponse?: MockResponse
  responseMap?: Map<string, MockResponse>
  shouldFail?: boolean
  failError?: Error
  networkDelay?: number
}

/**
 * Creates a mock fetch function for testing
 */
export function createFetchMock(config: FetchMockConfig = {}): Mock {
  const {
    defaultResponse = createSuccessResponse({}),
    responseMap = new Map(),
    shouldFail = false,
    failError = new Error("Network error"),
    networkDelay = 0,
  } = config

  return vi.fn().mockImplementation(async (url: string | URL) => {
    if (networkDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, networkDelay))
    }

    if (shouldFail) {
      throw failError
    }

    const urlString = url.toString()
    const response = responseMap.get(urlString) || defaultResponse

    return createMockResponse(response)
  })
}

/**
 * Creates a mock Response object
 */
function createMockResponse(config: MockResponse) {
  const { ok, status, statusText, body, headers = {} } = config

  return {
    ok,
    status,
    statusText,
    headers: new Map(Object.entries(headers)),
    json: vi.fn().mockImplementation(async () => {
      if (typeof body === "string") {
        return JSON.parse(body)
      }
      return body
    }),
    text: vi.fn().mockImplementation(async () => {
      if (typeof body === "string") {
        return body
      }
      return JSON.stringify(body)
    }),
    clone: vi.fn().mockReturnThis(),
  }
}

// Pre-configured response factories
export function createSuccessResponse(
  body: unknown,
  headers?: Record<string, string>
): MockResponse {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    body,
    headers,
  }
}

export function createErrorResponse(
  status: number,
  statusText: string,
  body?: unknown
): MockResponse {
  return {
    ok: false,
    status,
    statusText,
    body,
  }
}

// Pre-configured mock responses for common scenarios
export const mockResponses = {
  // OAuth responses
  oauthSuccess: createSuccessResponse(oauthTokenResponse),
  oauthError: createErrorResponse(400, "Bad Request", oauthErrorResponse),

  // Error responses
  notFound: createErrorResponse(404, "Not Found", notFoundErrorResponse),
  unauthorized: createErrorResponse(401, "Unauthorized", authErrorResponse),
  rateLimit: createErrorResponse(429, "Too Many Requests", rateLimitErrorResponse),
  serverError: createErrorResponse(500, "Internal Server Error", {
    code: 1,
    message: "Internal server error",
  }),
}

/**
 * Creates a fetch mock that handles OAuth token refresh
 */
export function createZohoFetchMock(apiResponses: Map<string, MockResponse> = new Map()): Mock {
  const ZOHO_OAUTH_URL = "https://accounts.zoho.com/oauth/v2/token"
  const ZOHO_API_BASE = "https://www.zohoapis.com/books/v3"

  return vi.fn().mockImplementation(async (url: string | URL) => {
    const urlString = url.toString()

    // Handle OAuth token refresh
    if (urlString === ZOHO_OAUTH_URL) {
      return createMockResponse(mockResponses.oauthSuccess)
    }

    // Handle API requests
    if (urlString.startsWith(ZOHO_API_BASE)) {
      // Check for specific URL match
      for (const [pattern, response] of apiResponses.entries()) {
        if (urlString.includes(pattern)) {
          return createMockResponse(response)
        }
      }
      // Default success response
      return createMockResponse(createSuccessResponse({ code: 0, message: "success" }))
    }

    // Unknown URL
    return createMockResponse(createErrorResponse(404, "Not Found"))
  })
}

/**
 * Creates a fetch mock that simulates network timeout
 */
export function createTimeoutFetchMock(timeoutMs: number = 5000): Mock {
  return vi.fn().mockImplementation(async () => {
    await new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Request timeout")), timeoutMs)
    })
  })
}

/**
 * Creates a fetch mock that simulates rate limiting
 */
export function createRateLimitFetchMock(requestLimit: number = 3): Mock {
  let requestCount = 0

  return vi.fn().mockImplementation(async () => {
    requestCount++
    if (requestCount > requestLimit) {
      return createMockResponse(mockResponses.rateLimit)
    }
    return createMockResponse(createSuccessResponse({ code: 0, message: "success" }))
  })
}
