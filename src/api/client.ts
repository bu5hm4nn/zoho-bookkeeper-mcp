/**
 * Zoho Books API Client
 */

import * as fs from "fs"
import * as path from "path"
import { getAccessToken, ZohoAuthError } from "../auth/oauth.js"
import { getZohoConfig } from "../config.js"
import { getMimeType, validateAttachment } from "../utils/mime-types.js"
import { parseZohoResponse, type ParsedResponse } from "../utils/response-parser.js"

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

  const options: RequestInit = {
    method,
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      "Content-Type": "application/json",
    },
  }

  if (body && method !== "GET" && method !== "HEAD") {
    // Zoho expects a JSONString parameter wrapping the actual data
    options.body = JSON.stringify({ JSONString: JSON.stringify(body) })
  }

  try {
    const response = await fetch(url.toString(), options)
    return parseZohoResponse<T>(response, endpoint)
  } catch (error) {
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

  // Validate the attachment file
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

  // Check if file exists
  if (!fs.existsSync(filePath)) {
    return {
      ok: false,
      errorMessage: `File not found: ${filePath}`,
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

  try {
    const response = await fetch(url.toString(), {
      method: "POST",
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        // DO NOT set Content-Type header - let fetch set it with the correct multipart boundary
      },
      body: formData,
    })

    return parseZohoResponse<Record<string, unknown>>(response, endpoint)
  } catch (error) {
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

  try {
    const response = await fetch(`${config.apiUrl}/organizations`, {
      method: "GET",
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        "Content-Type": "application/json",
      },
    })

    return parseZohoResponse<Record<string, unknown>>(response, "/organizations")
  } catch (error) {
    return {
      ok: false,
      errorMessage: `Request failed: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}
