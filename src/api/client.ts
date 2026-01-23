/**
 * Zoho Books API Client
 */

import * as fs from "fs"
import * as path from "path"
import { getAccessToken, ZohoAuthError } from "../auth/oauth.js"
import { getZohoConfig, MAX_FILE_SIZE_BYTES, REQUEST_TIMEOUT_MS } from "../config.js"
import { getMimeType, validateAttachment } from "../utils/mime-types.js"
import { parseZohoResponse, type ParsedResponse } from "../utils/response-parser.js"

// Security: Allowed base directories for file uploads
// Files can only be uploaded from these directories or their subdirectories
const ALLOWED_UPLOAD_DIRECTORIES = [
  "/app/documents", // Docker container path
  "/tmp", // Temporary files
  process.env.HOME ? path.join(process.env.HOME, "Documents") : "/home/Documents", // User documents
]

/**
 * Validate that a file path is within allowed directories (prevent path traversal)
 * Security: Prevents reading arbitrary files like /etc/passwd
 * Security: Uses realpath to resolve symlinks and prevent symlink-based attacks
 */
function validateFilePath(filePath: string): { valid: boolean; error?: string } {
  let realPath: string
  try {
    // Security: Resolve symlinks to get the canonical path
    // This prevents symlink attacks where a symlink in an allowed directory points to /etc/passwd
    realPath = fs.realpathSync(filePath)
  } catch {
    // File doesn't exist or can't be accessed - will be caught by existsSync check later
    // For now, fall back to resolved path for the directory check
    realPath = path.resolve(filePath)
  }

  // Check if real path is within allowed directories
  const isAllowed = ALLOWED_UPLOAD_DIRECTORIES.some((allowedDir) => {
    try {
      // Also resolve symlinks in allowed directories for consistent comparison
      const allowedReal = fs.realpathSync(allowedDir)
      return realPath === allowedReal || realPath.startsWith(allowedReal + path.sep)
    } catch {
      // Allowed directory doesn't exist, skip it
      return false
    }
  })

  if (!isAllowed) {
    // Security: Don't expose allowed directories in error message
    return {
      valid: false,
      error: "File path not in allowed upload directories",
    }
  }

  return { valid: true }
}

/**
 * Validate file size before reading
 * Security: Prevents OOM attacks from large files
 */
async function validateFileSize(
  filePath: string
): Promise<{ valid: boolean; error?: string; size?: number }> {
  try {
    const stats = await fs.promises.stat(filePath)
    if (stats.size > MAX_FILE_SIZE_BYTES) {
      return {
        valid: false,
        error: `File too large: ${(stats.size / 1024 / 1024).toFixed(2)}MB (max ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB)`,
      }
    }
    return { valid: true, size: stats.size }
  } catch {
    return { valid: false, error: "Unable to read file size" }
  }
}

/**
 * Create an AbortController with timeout
 * Security: Prevents hanging requests
 */
function createTimeoutController(timeoutMs: number = REQUEST_TIMEOUT_MS): {
  controller: AbortController
  timeoutId: ReturnType<typeof setTimeout>
} {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  return { controller, timeoutId }
}

/**
 * Resolve organization ID from parameter or environment config
 * Returns the resolved org ID or an error message if neither is available
 */
function resolveOrganizationId(organizationId?: string): { orgId: string } | { error: string } {
  const config = getZohoConfig()
  const orgId = organizationId || config.organizationId

  if (!orgId) {
    return {
      error:
        "Organization ID required. Set ZOHO_ORGANIZATION_ID environment variable or pass organization_id parameter.",
    }
  }

  return { orgId }
}

/**
 * Make a request to the Zoho Books API
 */
export async function zohoRequest<T>(
  method: string,
  endpoint: string,
  organizationId?: string,
  body?: Record<string, unknown>,
  queryParams?: Record<string, string>
): Promise<ParsedResponse<T>> {
  const config = getZohoConfig()

  // Resolve organization ID
  const orgIdResult = resolveOrganizationId(organizationId)
  if ("error" in orgIdResult) {
    return {
      ok: false,
      errorMessage: orgIdResult.error,
    }
  }

  let token: string

  try {
    token = await getAccessToken()
  } catch (error) {
    if (error instanceof ZohoAuthError) {
      return {
        ok: false,
        errorMessage: error.message,
      }
    }
    return {
      ok: false,
      errorMessage: `Authentication error: ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  // Build URL with query params
  const url = new URL(`${config.apiUrl}${endpoint}`)
  url.searchParams.set("organization_id", orgIdResult.orgId)

  if (queryParams) {
    Object.entries(queryParams).forEach(([key, value]) => {
      url.searchParams.set(key, value)
    })
  }

  // Security: Add request timeout
  const { controller, timeoutId } = createTimeoutController()

  const options: RequestInit = {
    method,
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      "Content-Type": "application/json",
    },
    signal: controller.signal,
  }

  if (body && method !== "GET" && method !== "HEAD") {
    // Zoho expects a JSONString parameter wrapping the actual data
    options.body = JSON.stringify({ JSONString: JSON.stringify(body) })
  }

  try {
    const response = await fetch(url.toString(), options)
    clearTimeout(timeoutId)
    return parseZohoResponse<T>(response, endpoint)
  } catch (error) {
    clearTimeout(timeoutId)
    if (error instanceof Error && error.name === "AbortError") {
      return {
        ok: false,
        errorMessage: `Request timeout after ${REQUEST_TIMEOUT_MS / 1000} seconds`,
      }
    }
    return {
      ok: false,
      errorMessage: `Request failed: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

/**
 * Make a GET request to the Zoho Books API
 */
export async function zohoGet<T>(
  endpoint: string,
  organizationId?: string,
  queryParams?: Record<string, string>
): Promise<ParsedResponse<T>> {
  return zohoRequest<T>("GET", endpoint, organizationId, undefined, queryParams)
}

/**
 * Make a POST request to the Zoho Books API
 */
export async function zohoPost<T>(
  endpoint: string,
  organizationId?: string,
  body?: Record<string, unknown>
): Promise<ParsedResponse<T>> {
  return zohoRequest<T>("POST", endpoint, organizationId, body)
}

/**
 * Make a PUT request to the Zoho Books API
 */
export async function zohoPut<T>(
  endpoint: string,
  organizationId?: string,
  body?: Record<string, unknown>
): Promise<ParsedResponse<T>> {
  return zohoRequest<T>("PUT", endpoint, organizationId, body)
}

/**
 * Make a DELETE request to the Zoho Books API
 */
export async function zohoDelete<T>(
  endpoint: string,
  organizationId?: string
): Promise<ParsedResponse<T>> {
  return zohoRequest<T>("DELETE", endpoint, organizationId)
}

/**
 * Upload a file attachment to a Zoho Books entity
 * Uses multipart/form-data for proper file upload
 */
export async function zohoUploadAttachment(
  endpoint: string,
  organizationId: string | undefined,
  filePath: string
): Promise<ParsedResponse<Record<string, unknown>>> {
  const config = getZohoConfig()

  // Resolve organization ID
  const orgIdResult = resolveOrganizationId(organizationId)
  if ("error" in orgIdResult) {
    return {
      ok: false,
      errorMessage: orgIdResult.error,
    }
  }

  let token: string

  // Security: Validate file path is within allowed directories (prevent path traversal)
  const pathValidation = validateFilePath(filePath)
  if (!pathValidation.valid) {
    return {
      ok: false,
      errorMessage: pathValidation.error,
    }
  }

  // Check if file exists
  if (!fs.existsSync(filePath)) {
    return {
      ok: false,
      // Security: Don't expose file path in error message
      errorMessage: "File not found or inaccessible",
    }
  }

  // Security: Validate file size before reading (prevent OOM)
  const sizeValidation = await validateFileSize(filePath)
  if (!sizeValidation.valid) {
    return {
      ok: false,
      errorMessage: sizeValidation.error,
    }
  }

  // Validate the attachment file type
  const validation = validateAttachment(filePath)
  if (!validation.valid) {
    return {
      ok: false,
      errorMessage: validation.error,
    }
  }

  try {
    token = await getAccessToken()
  } catch (error) {
    if (error instanceof ZohoAuthError) {
      return {
        ok: false,
        errorMessage: error.message,
      }
    }
    return {
      ok: false,
      errorMessage: `Authentication error: ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  // Build URL
  const url = new URL(`${config.apiUrl}${endpoint}`)
  url.searchParams.set("organization_id", orgIdResult.orgId)

  // Read file and create FormData
  const fileBuffer = fs.readFileSync(filePath)
  const fileName = path.basename(filePath)
  const mimeType = getMimeType(filePath)

  const formData = new FormData()
  const blob = new Blob([fileBuffer], { type: mimeType })
  formData.append("attachment", blob, fileName)

  // Security: Add request timeout
  const { controller, timeoutId } = createTimeoutController()

  try {
    const response = await fetch(url.toString(), {
      method: "POST",
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        // DO NOT set Content-Type header - let fetch set it with the correct multipart boundary
      },
      body: formData,
      signal: controller.signal,
    })

    clearTimeout(timeoutId)
    return parseZohoResponse<Record<string, unknown>>(response, endpoint)
  } catch (error) {
    clearTimeout(timeoutId)
    if (error instanceof Error && error.name === "AbortError") {
      return {
        ok: false,
        errorMessage: `Upload timeout after ${REQUEST_TIMEOUT_MS / 1000} seconds`,
      }
    }
    return {
      ok: false,
      errorMessage: `Upload failed: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

/**
 * Get attachment info from a Zoho Books entity
 */
export async function zohoGetAttachment(
  endpoint: string,
  organizationId?: string
): Promise<ParsedResponse<Record<string, unknown>>> {
  return zohoGet<Record<string, unknown>>(endpoint, organizationId)
}

/**
 * Delete attachment from a Zoho Books entity
 */
export async function zohoDeleteAttachment(
  endpoint: string,
  organizationId?: string
): Promise<ParsedResponse<Record<string, unknown>>> {
  return zohoDelete<Record<string, unknown>>(endpoint, organizationId)
}

/**
 * List organizations (special endpoint without organization_id)
 */
export async function zohoListOrganizations(): Promise<ParsedResponse<Record<string, unknown>>> {
  const config = getZohoConfig()
  let token: string

  try {
    token = await getAccessToken()
  } catch (error) {
    if (error instanceof ZohoAuthError) {
      return {
        ok: false,
        errorMessage: error.message,
      }
    }
    return {
      ok: false,
      errorMessage: `Authentication error: ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  // Security: Add request timeout
  const { controller, timeoutId } = createTimeoutController()

  try {
    const response = await fetch(`${config.apiUrl}/organizations`, {
      method: "GET",
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    })

    clearTimeout(timeoutId)
    return parseZohoResponse<Record<string, unknown>>(response, "/organizations")
  } catch (error) {
    clearTimeout(timeoutId)
    if (error instanceof Error && error.name === "AbortError") {
      return {
        ok: false,
        errorMessage: `Request timeout after ${REQUEST_TIMEOUT_MS / 1000} seconds`,
      }
    }
    return {
      ok: false,
      errorMessage: `Request failed: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}
