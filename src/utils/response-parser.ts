/**
 * Response parsing utilities for Zoho Books API
 */

import { parseZohoError, formatErrorForAI, type ZohoApiError } from "./errors.js"

export interface ParsedResponse<T> {
  ok: boolean
  data?: T
  error?: ZohoApiError
  errorMessage?: string
}

/**
 * Parse a Zoho Books API response
 */
export async function parseZohoResponse<T>(
  response: Response,
  endpoint?: string
): Promise<ParsedResponse<T>> {
  const responseText = await response.text()

  let data: Record<string, unknown>
  try {
    data = JSON.parse(responseText)
  } catch {
    // Non-JSON response
    if (!response.ok) {
      return {
        ok: false,
        error: {
          code: response.status,
          message: response.statusText,
          category: response.status >= 500 ? "server" : "unknown",
          suggestedAction: "Check the API endpoint and try again",
          endpoint,
          rawResponse: responseText,
        },
        errorMessage: `HTTP ${response.status}: ${response.statusText}`,
      }
    }
    // Success but non-JSON (unexpected)
    return {
      ok: false,
      errorMessage: "Unexpected non-JSON response from Zoho API",
    }
  }

  // Check for Zoho-specific error codes
  const code = data.code as number | undefined

  if (code !== undefined && code !== 0) {
    const error = parseZohoError(code, data.message as string, endpoint, responseText)
    return {
      ok: false,
      error,
      errorMessage: formatErrorForAI(error),
    }
  }

  // HTTP error without Zoho error code
  if (!response.ok) {
    const error = parseZohoError(
      response.status,
      (data.message as string) || response.statusText,
      endpoint,
      responseText
    )
    return {
      ok: false,
      error,
      errorMessage: formatErrorForAI(error),
    }
  }

  // Success
  return {
    ok: true,
    data: data as T,
  }
}

/**
 * Extract the main data from a Zoho response
 * Zoho responses typically have the data nested under a specific key
 */
export function extractData<T>(response: Record<string, unknown>, key: string): T | undefined {
  return response[key] as T | undefined
}

/**
 * Format a success message with data summary
 */
export function formatSuccessMessage(action: string, details?: string): string {
  let message = `**Success**: ${action}`
  if (details) {
    message += `\n${details}`
  }
  return message
}

/**
 * Format a list response for display
 */
export function formatListResponse<T extends Record<string, unknown>>(
  items: T[],
  itemFormatter: (item: T, index: number) => string,
  emptyMessage: string = "No items found"
): string {
  if (items.length === 0) {
    return emptyMessage
  }

  return items.map((item, index) => itemFormatter(item, index)).join("\n\n")
}
