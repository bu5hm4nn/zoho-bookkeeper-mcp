// src/index.ts
import { FastMCP } from "fastmcp";

// src/tools/organizations.ts
import { z as z2 } from "zod";

// src/api/client.ts
import * as fs from "fs";
import * as path2 from "path";

// src/config.ts
var MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
var REQUEST_TIMEOUT_MS = 3e4;
function getZohoConfig() {
  const clientId = process.env.ZOHO_CLIENT_ID || "";
  const clientSecret = process.env.ZOHO_CLIENT_SECRET || "";
  const refreshToken = process.env.ZOHO_REFRESH_TOKEN || "";
  const apiUrl = process.env.ZOHO_API_URL || "https://www.zohoapis.com/books/v3";
  const organizationId = process.env.ZOHO_ORGANIZATION_ID || "";
  return {
    clientId,
    clientSecret,
    refreshToken,
    apiUrl,
    organizationId
  };
}
function getServerConfig() {
  return {
    port: parseInt(process.env.PORT || "8004", 10),
    host: process.env.HOST || "0.0.0.0"
  };
}
function validateZohoConfig(config) {
  if (!config.clientId) {
    return { valid: false, error: "ZOHO_CLIENT_ID is not configured" };
  }
  if (!config.clientSecret) {
    return { valid: false, error: "ZOHO_CLIENT_SECRET is not configured" };
  }
  if (!config.refreshToken) {
    return { valid: false, error: "ZOHO_REFRESH_TOKEN is not configured" };
  }
  if (!config.apiUrl.startsWith("https://")) {
    return { valid: false, error: "ZOHO_API_URL must use HTTPS" };
  }
  return { valid: true };
}
function getZohoOAuthUrl(apiUrl) {
  if (apiUrl.includes("zohoapis.eu")) {
    return "https://accounts.zoho.eu/oauth/v2/token";
  }
  if (apiUrl.includes("zohoapis.in")) {
    return "https://accounts.zoho.in/oauth/v2/token";
  }
  if (apiUrl.includes("zohoapis.com.au")) {
    return "https://accounts.zoho.com.au/oauth/v2/token";
  }
  return "https://accounts.zoho.com/oauth/v2/token";
}

// src/auth/oauth.ts
var tokenState = null;
var TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1e3;
var ZohoAuthError = class extends Error {
  constructor(message, code, statusCode) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.name = "ZohoAuthError";
  }
};
async function getAccessToken() {
  const config = getZohoConfig();
  const validation = validateZohoConfig(config);
  if (!validation.valid) {
    throw new ZohoAuthError(
      `Zoho OAuth not configured: ${validation.error}. Set ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, and ZOHO_REFRESH_TOKEN.`,
      "OAUTH_NOT_CONFIGURED"
    );
  }
  if (tokenState && Date.now() < tokenState.expiresAt - TOKEN_EXPIRY_BUFFER_MS) {
    return tokenState.accessToken;
  }
  return refreshAccessToken(config);
}
async function refreshAccessToken(config) {
  const oauthUrl = getZohoOAuthUrl(config.apiUrl);
  try {
    const response = await fetch(oauthUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: config.refreshToken
      })
    });
    const data = await response.json();
    if (!response.ok) {
      const errorMessage = data.error_description || data.error || "Unknown error";
      throw new ZohoAuthError(
        `Failed to refresh token: ${errorMessage}`,
        data.error,
        response.status
      );
    }
    if (!data.access_token) {
      throw new ZohoAuthError("No access token in response", "NO_ACCESS_TOKEN");
    }
    const expiresIn = data.expires_in || 3600;
    tokenState = {
      accessToken: data.access_token,
      expiresAt: Date.now() + expiresIn * 1e3
    };
    return tokenState.accessToken;
  } catch (error) {
    if (error instanceof ZohoAuthError) {
      throw error;
    }
    throw new ZohoAuthError(
      `Failed to refresh token: ${error instanceof Error ? error.message : String(error)}`,
      "REFRESH_FAILED"
    );
  }
}

// src/utils/mime-types.ts
import * as path from "path";
var MIME_TYPES = {
  // Documents
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".rtf": "application/rtf",
  // Images
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".tiff": "image/tiff",
  ".tif": "image/tiff",
  // Archives
  ".zip": "application/zip",
  ".rar": "application/vnd.rar",
  ".7z": "application/x-7z-compressed",
  ".tar": "application/x-tar",
  ".gz": "application/gzip"
};
var ZOHO_SUPPORTED_EXTENSIONS = /* @__PURE__ */ new Set([
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx"
]);
function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || "application/octet-stream";
}
function isSupportedExtension(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ZOHO_SUPPORTED_EXTENSIONS.has(ext);
}
function getSupportedExtensions() {
  return Array.from(ZOHO_SUPPORTED_EXTENSIONS);
}
function validateAttachment(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!ext) {
    return { valid: false, error: "File has no extension" };
  }
  if (!isSupportedExtension(filePath)) {
    return {
      valid: false,
      error: `Unsupported file type: ${ext}. Supported types: ${getSupportedExtensions().join(", ")}`
    };
  }
  return { valid: true };
}

// src/utils/errors.ts
var ZOHO_ERROR_CODES = {
  0: { message: "Success", action: "No action needed", category: "validation" },
  1: {
    message: "Internal error",
    action: "Try again later or contact support",
    category: "server"
  },
  2: { message: "Invalid URL", action: "Check the API endpoint URL", category: "validation" },
  4: {
    message: "Invalid value",
    action: "Check the parameter values match expected types",
    category: "validation"
  },
  5: {
    message: "Invalid parameter",
    action: "Review required and optional parameters",
    category: "validation"
  },
  9: {
    message: "Record not found",
    action: "Verify the ID exists - use list endpoints to find valid IDs",
    category: "not_found"
  },
  10: {
    message: "Missing mandatory parameter",
    action: "Add the required parameter to your request",
    category: "validation"
  },
  14: {
    message: "Authorization failed",
    action: "Check your access token and permissions",
    category: "auth"
  },
  36: {
    message: "Rate limit exceeded",
    action: "Wait 1 minute before retrying",
    category: "rate_limit"
  },
  57: {
    message: "OAuth token expired",
    action: "Token will be auto-refreshed on next request",
    category: "auth"
  },
  2006: {
    message: "Record not found",
    action: "The specified resource does not exist. Use list endpoints to find valid IDs.",
    category: "not_found"
  },
  6e3: {
    message: "Invalid OAuth token",
    action: "Token will be auto-refreshed on next request",
    category: "auth"
  }
};
function parseZohoError(code, apiMessage, endpoint, _rawResponse) {
  const knownError = ZOHO_ERROR_CODES[code];
  if (knownError) {
    return {
      code,
      message: apiMessage || knownError.message,
      category: knownError.category,
      suggestedAction: knownError.action,
      endpoint
    };
  }
  return {
    code,
    message: apiMessage || "Unknown error",
    category: "unknown",
    suggestedAction: "Check the Zoho Books API documentation for this error code",
    endpoint
  };
}
function formatErrorForAI(error) {
  let result = `**Zoho Error ${error.code}**: ${error.message}`;
  if (error.suggestedAction) {
    result += `
**Suggested Action**: ${error.suggestedAction}`;
  }
  if (error.endpoint) {
    result += `
**Endpoint**: ${error.endpoint}`;
  }
  return result;
}

// src/utils/response-parser.ts
async function parseZohoResponse(response, endpoint) {
  const responseText = await response.text();
  let data;
  try {
    data = JSON.parse(responseText);
  } catch {
    if (!response.ok) {
      return {
        ok: false,
        error: {
          code: response.status,
          message: response.statusText,
          category: response.status >= 500 ? "server" : "unknown",
          suggestedAction: "Check the API endpoint and try again",
          endpoint
          // Note: rawResponse intentionally omitted to prevent leaking sensitive data
        },
        errorMessage: `HTTP ${response.status}: ${response.statusText}`
      };
    }
    return {
      ok: false,
      errorMessage: "Unexpected non-JSON response from Zoho API"
    };
  }
  const code = data.code;
  if (code !== void 0 && code !== 0) {
    const error = parseZohoError(code, data.message, endpoint, responseText);
    return {
      ok: false,
      error,
      errorMessage: formatErrorForAI(error)
    };
  }
  if (!response.ok) {
    const error = parseZohoError(
      response.status,
      data.message || response.statusText,
      endpoint,
      responseText
    );
    return {
      ok: false,
      error,
      errorMessage: formatErrorForAI(error)
    };
  }
  return {
    ok: true,
    data
  };
}

// src/api/client.ts
var ALLOWED_UPLOAD_DIRECTORIES = [
  "/app/documents",
  // Docker container path
  "/tmp/zoho-bookkeeper-uploads",
  // App-specific temp directory (narrower than /tmp)
  process.env.HOME ? path2.join(process.env.HOME, "Documents") : void 0,
  // User documents
  process.env.ZOHO_ALLOWED_UPLOAD_DIR
  // Optional override/additional safe directory
].filter((d) => Boolean(d));
function normalizeForCompare(p) {
  const normalized = path2.normalize(p);
  return process.platform === "win32" || process.platform === "darwin" ? normalized.toLowerCase() : normalized;
}
function sanitizeFilename(filename) {
  return filename.replace(/[\r\n]/g, "").replace(/[/\\]/g, "_");
}
function validateFilePath(filePath) {
  const resolvedInput = path2.resolve(filePath);
  let realPath = resolvedInput;
  try {
    if (fs.existsSync(filePath)) {
      realPath = fs.realpathSync(filePath);
    }
  } catch {
    realPath = resolvedInput;
  }
  const normalizedRealPath = normalizeForCompare(realPath);
  const isAllowed = ALLOWED_UPLOAD_DIRECTORIES.some((allowedDir) => {
    const resolvedAllowed = path2.resolve(allowedDir);
    let allowedReal = resolvedAllowed;
    try {
      if (fs.existsSync(allowedDir)) {
        allowedReal = fs.realpathSync(allowedDir);
      }
    } catch {
      allowedReal = resolvedAllowed;
    }
    const normalizedAllowed = normalizeForCompare(allowedReal);
    return normalizedRealPath === normalizedAllowed || normalizedRealPath.startsWith(normalizedAllowed + path2.sep);
  });
  if (!isAllowed) {
    return {
      valid: false,
      error: "File path not in allowed upload directories"
    };
  }
  return { valid: true, resolvedPath: realPath };
}
function createTimeoutController(timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  if (typeof timeoutId === "object" && "unref" in timeoutId) {
    timeoutId.unref();
  }
  return { controller, timeoutId, timeoutMs };
}
function resolveOrganizationId(organizationId) {
  const config = getZohoConfig();
  const orgId = organizationId || config.organizationId;
  if (!orgId) {
    return {
      error: "Organization ID required. Set ZOHO_ORGANIZATION_ID environment variable or pass organization_id parameter."
    };
  }
  return { orgId };
}
async function zohoRequest(method, endpoint, organizationId, body, queryParams) {
  const config = getZohoConfig();
  const orgIdResult = resolveOrganizationId(organizationId);
  if ("error" in orgIdResult) {
    return {
      ok: false,
      errorMessage: orgIdResult.error
    };
  }
  let token;
  try {
    token = await getAccessToken();
  } catch (error) {
    if (error instanceof ZohoAuthError) {
      return {
        ok: false,
        errorMessage: error.message
      };
    }
    return {
      ok: false,
      errorMessage: `Authentication error: ${error instanceof Error ? error.message : String(error)}`
    };
  }
  const url = new URL(`${config.apiUrl}${endpoint}`);
  url.searchParams.set("organization_id", orgIdResult.orgId);
  if (queryParams) {
    Object.entries(queryParams).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
  }
  const { controller, timeoutId, timeoutMs } = createTimeoutController();
  const options = {
    method,
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      "Content-Type": "application/json"
    },
    signal: controller.signal
  };
  if (body && method !== "GET" && method !== "HEAD") {
    options.body = JSON.stringify({ JSONString: JSON.stringify(body) });
  }
  try {
    const response = await fetch(url.toString(), options);
    return parseZohoResponse(response, endpoint);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        ok: false,
        errorMessage: `Request timeout after ${timeoutMs / 1e3} seconds`
      };
    }
    return {
      ok: false,
      errorMessage: `Request failed: ${error instanceof Error ? error.message : String(error)}`
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
async function zohoGet(endpoint, organizationId, queryParams) {
  return zohoRequest("GET", endpoint, organizationId, void 0, queryParams);
}
async function zohoPost(endpoint, organizationId, body) {
  return zohoRequest("POST", endpoint, organizationId, body);
}
async function zohoPut(endpoint, organizationId, body) {
  return zohoRequest("PUT", endpoint, organizationId, body);
}
async function zohoDelete(endpoint, organizationId) {
  return zohoRequest("DELETE", endpoint, organizationId);
}
async function zohoUploadAttachment(endpoint, organizationId, filePath) {
  const config = getZohoConfig();
  const orgIdResult = resolveOrganizationId(organizationId);
  if ("error" in orgIdResult) {
    return {
      ok: false,
      errorMessage: orgIdResult.error
    };
  }
  let token;
  const pathValidation = validateFilePath(filePath);
  if (!pathValidation.valid || !pathValidation.resolvedPath) {
    return {
      ok: false,
      errorMessage: pathValidation.error || "Invalid file path"
    };
  }
  const resolvedPath = pathValidation.resolvedPath;
  const validation = validateAttachment(resolvedPath);
  if (!validation.valid) {
    return {
      ok: false,
      errorMessage: validation.error
    };
  }
  let fileBuffer;
  let fileName;
  let mimeType;
  let fh;
  try {
    const flags = typeof fs.constants.O_NOFOLLOW === "number" ? fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW : fs.constants.O_RDONLY;
    fh = await fs.promises.open(resolvedPath, flags);
    const stats = await fh.stat();
    if (!stats.isFile()) {
      return {
        ok: false,
        errorMessage: "Upload path must be a regular file"
      };
    }
    if (stats.size > MAX_FILE_SIZE_BYTES) {
      return {
        ok: false,
        errorMessage: `File too large: ${(stats.size / 1024 / 1024).toFixed(2)}MB (max ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB)`
      };
    }
    fileBuffer = await fh.readFile();
    fileName = sanitizeFilename(path2.basename(resolvedPath));
    mimeType = getMimeType(resolvedPath);
  } catch (e) {
    const err = e;
    if (err?.code === "ELOOP") {
      return {
        ok: false,
        errorMessage: "Symlinks are not allowed for uploads"
      };
    }
    return {
      ok: false,
      errorMessage: "File not found or inaccessible"
    };
  } finally {
    await fh?.close().catch(() => void 0);
  }
  try {
    token = await getAccessToken();
  } catch (error) {
    if (error instanceof ZohoAuthError) {
      return {
        ok: false,
        errorMessage: error.message
      };
    }
    return {
      ok: false,
      errorMessage: `Authentication error: ${error instanceof Error ? error.message : String(error)}`
    };
  }
  const url = new URL(`${config.apiUrl}${endpoint}`);
  url.searchParams.set("organization_id", orgIdResult.orgId);
  const formData = new FormData();
  const blob = new Blob([fileBuffer], { type: mimeType });
  formData.append("attachment", blob, fileName);
  const { controller, timeoutId, timeoutMs } = createTimeoutController();
  try {
    const response = await fetch(url.toString(), {
      method: "POST",
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`
        // DO NOT set Content-Type header - let fetch set it with the correct multipart boundary
      },
      body: formData,
      signal: controller.signal
    });
    return parseZohoResponse(response, endpoint);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        ok: false,
        errorMessage: `Upload timeout after ${timeoutMs / 1e3} seconds`
      };
    }
    return {
      ok: false,
      errorMessage: `Upload failed: ${error instanceof Error ? error.message : String(error)}`
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
async function zohoDeleteAttachment(endpoint, organizationId) {
  return zohoDelete(endpoint, organizationId);
}
async function zohoListOrganizations() {
  const config = getZohoConfig();
  let token;
  try {
    token = await getAccessToken();
  } catch (error) {
    if (error instanceof ZohoAuthError) {
      return {
        ok: false,
        errorMessage: error.message
      };
    }
    return {
      ok: false,
      errorMessage: `Authentication error: ${error instanceof Error ? error.message : String(error)}`
    };
  }
  const { controller, timeoutId, timeoutMs } = createTimeoutController();
  try {
    const response = await fetch(`${config.apiUrl}/organizations`, {
      method: "GET",
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        "Content-Type": "application/json"
      },
      signal: controller.signal
    });
    return parseZohoResponse(response, "/organizations");
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        ok: false,
        errorMessage: `Request timeout after ${timeoutMs / 1e3} seconds`
      };
    }
    return {
      ok: false,
      errorMessage: `Request failed: ${error instanceof Error ? error.message : String(error)}`
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

// src/utils/validation.ts
import { z } from "zod";
var DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
var dateSchema = z.string().regex(DATE_REGEX, "Date must be in YYYY-MM-DD format").refine(
  (date) => {
    const [yStr, mStr, dStr] = date.split("-");
    const y = Number(yStr);
    const m = Number(mStr);
    const d = Number(dStr);
    if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.toISOString().slice(0, 10) === date;
  },
  { message: "Invalid date value" }
);
var optionalDateSchema = dateSchema.optional();
var moneySchema = z.number().positive("Amount must be positive").max(99999999999e-2, "Amount exceeds maximum allowed value").refine((val) => Number.isFinite(val), { message: "Amount must be a finite number" }).refine((val) => Math.round(val * 100) / 100 === val, {
  message: "Amount must have at most 2 decimal places"
});
var moneyOrZeroSchema = z.number().min(0, "Amount cannot be negative").max(99999999999e-2, "Amount exceeds maximum allowed value").refine((val) => Number.isFinite(val), { message: "Amount must be a finite number" }).refine((val) => Math.round(val * 100) / 100 === val, {
  message: "Amount must have at most 2 decimal places"
});
var organizationIdSchema = z.string().regex(/^[a-zA-Z0-9_-]+$/, "Invalid organization ID format").max(50, "Organization ID too long");
var optionalOrganizationIdSchema = organizationIdSchema.optional();
var entityIdSchema = z.string().regex(/^[a-zA-Z0-9_-]+$/, "Invalid ID format").max(50, "ID too long");

// src/tools/organizations.ts
function registerOrganizationTools(server2) {
  server2.addTool({
    name: "list_organizations",
    description: `List all Zoho organizations the user has access to.
Use this tool first to get organization_id for all other tools.
Returns organization name, ID, currency, and timezone.`,
    parameters: z2.object({}),
    annotations: {
      title: "List Organizations",
      readOnlyHint: true,
      openWorldHint: true
    },
    execute: async () => {
      const result = await zohoListOrganizations();
      if (!result.ok) {
        return result.errorMessage || "Failed to list organizations";
      }
      const organizations = result.data?.organizations || [];
      if (organizations.length === 0) {
        return "No organizations found. Make sure your Zoho credentials have access to at least one organization.";
      }
      const formatted = organizations.map((org, index) => {
        return `${index + 1}. **${org.name}**${org.is_default_org ? " (default)" : ""}
   - Organization ID: \`${org.organization_id}\`
   - Currency: ${org.currency_code} (${org.currency_symbol})
   - Timezone: ${org.time_zone}
   - Fiscal Year Start: Month ${org.fiscal_year_start_month}`;
      }).join("\n\n");
      return `**Zoho Organizations**

${formatted}

---
Use the organization_id in subsequent API calls.`;
    }
  });
  server2.addTool({
    name: "get_organization",
    description: `Get detailed information about a specific organization.
Returns full organization details including address, contact info, and settings.`,
    parameters: z2.object({
      organization_id: optionalOrganizationIdSchema.describe(
        "Zoho org ID (uses ZOHO_ORGANIZATION_ID env var if not provided)"
      )
    }),
    annotations: {
      title: "Get Organization Details",
      readOnlyHint: true,
      openWorldHint: true
    },
    execute: async (args) => {
      const result = await zohoGet(
        `/organizations/${args.organization_id}`,
        args.organization_id
      );
      if (!result.ok) {
        return result.errorMessage || "Failed to get organization";
      }
      const org = result.data?.organization;
      if (!org) {
        return "Organization not found";
      }
      return `**Organization Details**

- **Name**: ${org.name}
- **Organization ID**: \`${org.organization_id}\`
- **Default Org**: ${org.is_default_org ? "Yes" : "No"}
- **Currency**: ${org.currency_code} (${org.currency_symbol})
- **Timezone**: ${org.time_zone}
- **Language**: ${org.language_code}
- **Fiscal Year Start**: Month ${org.fiscal_year_start_month}
- **Created**: ${org.account_created_date}`;
    }
  });
}

// src/tools/chart-of-accounts.ts
import { z as z3 } from "zod";
function registerChartOfAccountsTools(server2) {
  server2.addTool({
    name: "list_accounts",
    description: `List all accounts in the chart of accounts.
Supports filtering by account type (e.g., income, expense, asset, liability, equity).
Use this to find account_id values for journal entries and transactions.`,
    parameters: z3.object({
      organization_id: optionalOrganizationIdSchema.describe(
        "Zoho org ID (uses ZOHO_ORGANIZATION_ID env var if not provided)"
      ),
      filter_by: z3.enum([
        "AccountType.All",
        "AccountType.Active",
        "AccountType.Inactive",
        "AccountType.Asset",
        "AccountType.Liability",
        "AccountType.Equity",
        "AccountType.Income",
        "AccountType.Expense"
      ]).optional().describe("Filter accounts by type"),
      sort_column: z3.enum(["account_name", "account_type", "account_code"]).optional().describe("Column to sort by")
    }),
    annotations: {
      title: "List Chart of Accounts",
      readOnlyHint: true,
      openWorldHint: true
    },
    execute: async (args) => {
      const queryParams = {};
      if (args.filter_by) queryParams.filter_by = args.filter_by;
      if (args.sort_column) queryParams.sort_column = args.sort_column;
      const result = await zohoGet(
        "/chartofaccounts",
        args.organization_id,
        queryParams
      );
      if (!result.ok) {
        return result.errorMessage || "Failed to list accounts";
      }
      const accounts = result.data?.chartofaccounts || [];
      if (accounts.length === 0) {
        return "No accounts found.";
      }
      const formatted = accounts.map((acc, index) => {
        const balance = acc.current_balance !== void 0 ? ` | Balance: ${acc.current_balance}` : "";
        return `${index + 1}. **${acc.account_name}** (${acc.account_type_formatted})
   - Account ID: \`${acc.account_id}\`
   - Code: ${acc.account_code || "N/A"}
   - Active: ${acc.is_active ? "Yes" : "No"}${balance}`;
      }).join("\n\n");
      return `**Chart of Accounts** (${accounts.length} accounts)

${formatted}`;
    }
  });
  server2.addTool({
    name: "get_account",
    description: `Get detailed information about a specific account.
Returns account details including balance, currency, and parent account info.`,
    parameters: z3.object({
      organization_id: optionalOrganizationIdSchema.describe(
        "Zoho org ID (uses ZOHO_ORGANIZATION_ID env var if not provided)"
      ),
      account_id: z3.string().describe("Account ID")
    }),
    annotations: {
      title: "Get Account Details",
      readOnlyHint: true,
      openWorldHint: true
    },
    execute: async (args) => {
      const result = await zohoGet(
        `/chartofaccounts/${args.account_id}`,
        args.organization_id
      );
      if (!result.ok) {
        return result.errorMessage || "Failed to get account";
      }
      const account = result.data?.account;
      if (!account) {
        return "Account not found";
      }
      let details = `**Account Details**

- **Name**: ${account.account_name}
- **Account ID**: \`${account.account_id}\`
- **Code**: ${account.account_code || "N/A"}
- **Type**: ${account.account_type_formatted}
- **Active**: ${account.is_active ? "Yes" : "No"}
- **User Created**: ${account.is_user_created ? "Yes" : "No (system account)"}`;
      if (account.current_balance !== void 0) {
        details += `
- **Current Balance**: ${account.currency_code || ""} ${account.current_balance}`;
      }
      if (account.parent_account_name) {
        details += `
- **Parent Account**: ${account.parent_account_name}`;
      }
      if (account.description) {
        details += `
- **Description**: ${account.description}`;
      }
      return details;
    }
  });
  server2.addTool({
    name: "create_account",
    description: `Create a new account in the chart of accounts.
Account types: income, expense, cost_of_goods_sold, other_income, other_expense,
asset (bank, other_current_asset, fixed_asset, other_asset, cash, accounts_receivable),
liability (other_current_liability, credit_card, long_term_liability, other_liability, accounts_payable),
equity (equity, retained_earnings).`,
    parameters: z3.object({
      organization_id: optionalOrganizationIdSchema.describe(
        "Zoho org ID (uses ZOHO_ORGANIZATION_ID env var if not provided)"
      ),
      account_name: z3.string().describe("Name for the new account"),
      account_type: z3.string().describe("Account type (e.g., expense, income, bank, accounts_receivable)"),
      account_code: z3.string().optional().describe("Optional account code for reference"),
      description: z3.string().optional().describe("Description of the account"),
      currency_id: z3.string().optional().describe("Currency ID for the account"),
      parent_account_id: z3.string().optional().describe("Parent account ID for sub-accounts")
    }),
    annotations: {
      title: "Create Account",
      readOnlyHint: false,
      openWorldHint: true
    },
    execute: async (args) => {
      const payload = {
        account_name: args.account_name,
        account_type: args.account_type
      };
      if (args.account_code) payload.account_code = args.account_code;
      if (args.description) payload.description = args.description;
      if (args.currency_id) payload.currency_id = args.currency_id;
      if (args.parent_account_id) payload.parent_account_id = args.parent_account_id;
      const result = await zohoPost(
        "/chartofaccounts",
        args.organization_id,
        payload
      );
      if (!result.ok) {
        return result.errorMessage || "Failed to create account";
      }
      const account = result.data?.account;
      if (!account) {
        return "Account created but no details returned";
      }
      return `**Account Created Successfully**

- **Name**: ${account.account_name}
- **Account ID**: \`${account.account_id}\`
- **Code**: ${account.account_code || "N/A"}
- **Type**: ${account.account_type_formatted}`;
    }
  });
  server2.addTool({
    name: "list_account_transactions",
    description: `List transactions for a specific account.
Returns all transactions (journals, invoices, bills, etc.) affecting this account.
Useful for account reconciliation and analysis.`,
    parameters: z3.object({
      organization_id: optionalOrganizationIdSchema.describe(
        "Zoho org ID (uses ZOHO_ORGANIZATION_ID env var if not provided)"
      ),
      account_id: z3.string().describe("Account ID to get transactions for"),
      date_start: z3.string().optional().describe("Start date (YYYY-MM-DD)"),
      date_end: z3.string().optional().describe("End date (YYYY-MM-DD)"),
      sort_column: z3.enum(["transaction_date", "amount"]).optional().describe("Column to sort by")
    }),
    annotations: {
      title: "List Account Transactions",
      readOnlyHint: true,
      openWorldHint: true
    },
    execute: async (args) => {
      const queryParams = {
        account_id: args.account_id
      };
      if (args.date_start) queryParams.date_start = args.date_start;
      if (args.date_end) queryParams.date_end = args.date_end;
      if (args.sort_column) queryParams.sort_column = args.sort_column;
      const result = await zohoGet(
        "/chartofaccounts/transactions",
        args.organization_id,
        queryParams
      );
      if (!result.ok) {
        return result.errorMessage || "Failed to list transactions";
      }
      const transactions = result.data?.transactions || [];
      if (transactions.length === 0) {
        return "No transactions found for this account.";
      }
      const formatted = transactions.map((tx, index) => {
        const amount = tx.debit_or_credit === "debit" ? `Debit: ${tx.debit_amount}` : `Credit: ${tx.credit_amount}`;
        return `${index + 1}. **${tx.transaction_date}** - ${tx.transaction_type_formatted}
   - ${amount}
   - Description: ${tx.description || "N/A"}
   - Offset Account: ${tx.offset_account_name || "N/A"}`;
      }).join("\n\n");
      return `**Account Transactions** (${transactions.length} transactions)

${formatted}`;
    }
  });
}

// src/tools/journals.ts
import { z as z4 } from "zod";
var lineItemSchema = z4.object({
  account_id: entityIdSchema.describe("Account ID from chart of accounts"),
  debit_or_credit: z4.enum(["debit", "credit"]).describe("Whether this line is a debit or credit"),
  amount: moneySchema.describe("Amount for this line item (max 999,999,999.99, 2 decimal places)"),
  description: z4.string().max(500).optional().describe("Description for this line item"),
  customer_id: entityIdSchema.optional().describe("Customer ID if applicable")
});
function registerJournalTools(server2) {
  server2.addTool({
    name: "list_journals",
    description: `List all manual journal entries.
Returns journal entries with date, reference number, and total.
Use date filters to narrow down results.`,
    parameters: z4.object({
      organization_id: optionalOrganizationIdSchema.describe(
        "Zoho org ID (uses ZOHO_ORGANIZATION_ID env var if not provided)"
      ),
      date_start: optionalDateSchema.describe("Start date (YYYY-MM-DD)"),
      date_end: optionalDateSchema.describe("End date (YYYY-MM-DD)"),
      sort_column: z4.enum(["journal_date", "total", "created_time"]).optional(),
      page: z4.number().int().positive().optional().describe("Page number"),
      per_page: z4.number().int().min(1).max(200).optional().describe("Items per page (max 200)")
    }),
    annotations: {
      title: "List Journals",
      readOnlyHint: true,
      openWorldHint: true
    },
    execute: async (args) => {
      const queryParams = {};
      if (args.date_start) queryParams.date_start = args.date_start;
      if (args.date_end) queryParams.date_end = args.date_end;
      if (args.sort_column) queryParams.sort_column = args.sort_column;
      if (args.page) queryParams.page = args.page.toString();
      if (args.per_page) queryParams.per_page = args.per_page.toString();
      const result = await zohoGet(
        "/journals",
        args.organization_id,
        queryParams
      );
      if (!result.ok) {
        return result.errorMessage || "Failed to list journals";
      }
      const journals = result.data?.journals || [];
      if (journals.length === 0) {
        return "No journal entries found.";
      }
      const formatted = journals.map((j, index) => {
        return `${index + 1}. **${j.journal_date}** - ${j.reference_number || j.entry_number || "No ref"}
   - Journal ID: \`${j.journal_id}\`
   - Total: ${j.currency_code || ""} ${j.total}
   - Notes: ${j.notes || "N/A"}`;
      }).join("\n\n");
      return `**Journal Entries** (${journals.length} entries)

${formatted}`;
    }
  });
  server2.addTool({
    name: "get_journal",
    description: `Get detailed information about a specific journal entry.
Returns full journal details including all line items.`,
    parameters: z4.object({
      organization_id: optionalOrganizationIdSchema.describe(
        "Zoho org ID (uses ZOHO_ORGANIZATION_ID env var if not provided)"
      ),
      journal_id: entityIdSchema.describe("Journal ID")
    }),
    annotations: {
      title: "Get Journal Details",
      readOnlyHint: true,
      openWorldHint: true
    },
    execute: async (args) => {
      const result = await zohoGet(
        `/journals/${args.journal_id}`,
        args.organization_id
      );
      if (!result.ok) {
        return result.errorMessage || "Failed to get journal";
      }
      const journal = result.data?.journal;
      if (!journal) {
        return "Journal not found";
      }
      let details = `**Journal Entry Details**

- **Journal ID**: \`${journal.journal_id}\`
- **Date**: ${journal.journal_date}
- **Entry Number**: ${journal.entry_number || "N/A"}
- **Reference**: ${journal.reference_number || "N/A"}
- **Total**: ${journal.currency_code || ""} ${journal.total}
- **Notes**: ${journal.notes || "N/A"}

**Line Items**:`;
      if (journal.line_items && journal.line_items.length > 0) {
        journal.line_items.forEach((item, i) => {
          const amount = item.debit_or_credit === "debit" ? `Debit: ${item.amount}` : `Credit: ${item.amount}`;
          details += `
${i + 1}. ${item.account_name || item.account_id} - ${amount}`;
          if (item.description) details += `
   Description: ${item.description}`;
        });
      }
      return details;
    }
  });
  server2.addTool({
    name: "create_journal",
    description: `Create a new manual journal entry.
Line items must balance (total debits = total credits).
Use list_accounts to find valid account_id values.`,
    parameters: z4.object({
      organization_id: optionalOrganizationIdSchema.describe(
        "Zoho org ID (uses ZOHO_ORGANIZATION_ID env var if not provided)"
      ),
      journal_date: dateSchema.describe("Journal date (YYYY-MM-DD)"),
      reference_number: z4.string().max(100).optional().describe("Reference number for the journal"),
      notes: z4.string().max(2e3).optional().describe("Notes or memo for the journal"),
      line_items: z4.array(lineItemSchema).min(2).describe("Array of line items (min 2, must balance)")
    }),
    annotations: {
      title: "Create Journal",
      readOnlyHint: false,
      openWorldHint: true
    },
    execute: async (args) => {
      let totalDebits = 0;
      let totalCredits = 0;
      args.line_items.forEach((item) => {
        if (item.debit_or_credit === "debit") {
          totalDebits += item.amount;
        } else {
          totalCredits += item.amount;
        }
      });
      if (Math.abs(totalDebits - totalCredits) > 0.01) {
        return `**Validation Error**: Journal does not balance.
- Total Debits: ${totalDebits.toFixed(2)}
- Total Credits: ${totalCredits.toFixed(2)}
- Difference: ${Math.abs(totalDebits - totalCredits).toFixed(2)}

Debits must equal credits for a valid journal entry.`;
      }
      const payload = {
        journal_date: args.journal_date,
        line_items: args.line_items
      };
      if (args.reference_number) payload.reference_number = args.reference_number;
      if (args.notes) payload.notes = args.notes;
      const result = await zohoPost(
        "/journals",
        args.organization_id,
        payload
      );
      if (!result.ok) {
        return result.errorMessage || "Failed to create journal";
      }
      const journal = result.data?.journal;
      if (!journal) {
        return "Journal created but no details returned";
      }
      return `**Journal Created Successfully**

- **Journal ID**: \`${journal.journal_id}\`
- **Date**: ${journal.journal_date}
- **Entry Number**: ${journal.entry_number || "N/A"}
- **Total**: ${journal.currency_code || ""} ${journal.total}

Use this journal_id to add attachments or update the journal.`;
    }
  });
  server2.addTool({
    name: "update_journal",
    description: `Update an existing journal entry.
Can update date, reference, notes, and line items.
Line items must still balance after update.`,
    parameters: z4.object({
      organization_id: optionalOrganizationIdSchema.describe(
        "Zoho org ID (uses ZOHO_ORGANIZATION_ID env var if not provided)"
      ),
      journal_id: entityIdSchema.describe("Journal ID to update"),
      journal_date: optionalDateSchema.describe("New journal date (YYYY-MM-DD)"),
      reference_number: z4.string().max(100).optional().describe("New reference number"),
      notes: z4.string().max(2e3).optional().describe("New notes"),
      line_items: z4.array(lineItemSchema).min(2).optional().describe("New line items (replaces existing)")
    }),
    annotations: {
      title: "Update Journal",
      readOnlyHint: false,
      openWorldHint: true
    },
    execute: async (args) => {
      const payload = {};
      if (args.journal_date) payload.journal_date = args.journal_date;
      if (args.reference_number) payload.reference_number = args.reference_number;
      if (args.notes) payload.notes = args.notes;
      if (args.line_items) {
        let totalDebits = 0;
        let totalCredits = 0;
        args.line_items.forEach((item) => {
          if (item.debit_or_credit === "debit") {
            totalDebits += item.amount;
          } else {
            totalCredits += item.amount;
          }
        });
        if (Math.abs(totalDebits - totalCredits) > 0.01) {
          return `**Validation Error**: Line items do not balance.
- Total Debits: ${totalDebits.toFixed(2)}
- Total Credits: ${totalCredits.toFixed(2)}`;
        }
        payload.line_items = args.line_items;
      }
      const result = await zohoPut(
        `/journals/${args.journal_id}`,
        args.organization_id,
        payload
      );
      if (!result.ok) {
        return result.errorMessage || "Failed to update journal";
      }
      return `**Journal Updated Successfully**

Journal ID: \`${args.journal_id}\``;
    }
  });
  server2.addTool({
    name: "delete_journal",
    description: `Delete a journal entry.
This action cannot be undone. The journal will be permanently removed.`,
    parameters: z4.object({
      organization_id: optionalOrganizationIdSchema.describe(
        "Zoho org ID (uses ZOHO_ORGANIZATION_ID env var if not provided)"
      ),
      journal_id: entityIdSchema.describe("Journal ID to delete")
    }),
    annotations: {
      title: "Delete Journal",
      readOnlyHint: false,
      openWorldHint: true
    },
    execute: async (args) => {
      const result = await zohoDelete(`/journals/${args.journal_id}`, args.organization_id);
      if (!result.ok) {
        return result.errorMessage || "Failed to delete journal";
      }
      return `**Journal Deleted Successfully**

Journal ID \`${args.journal_id}\` has been deleted.`;
    }
  });
  server2.addTool({
    name: "publish_journal",
    description: `Publish (mark as posted) a draft journal entry.
Published journals are finalized and affect account balances.`,
    parameters: z4.object({
      organization_id: optionalOrganizationIdSchema.describe(
        "Zoho org ID (uses ZOHO_ORGANIZATION_ID env var if not provided)"
      ),
      journal_id: entityIdSchema.describe("Journal ID to publish")
    }),
    annotations: {
      title: "Publish Journal",
      readOnlyHint: false,
      openWorldHint: true
    },
    execute: async (args) => {
      const result = await zohoPost(
        `/journals/${args.journal_id}/status/publish`,
        args.organization_id,
        {}
      );
      if (!result.ok) {
        return result.errorMessage || "Failed to publish journal";
      }
      return `**Journal Published Successfully**

Journal ID \`${args.journal_id}\` has been marked as published.`;
    }
  });
  server2.addTool({
    name: "add_journal_attachment",
    description: `Upload a file attachment to a journal entry.
Supported file types: PDF, PNG, JPG, JPEG, GIF, DOC, DOCX, XLS, XLSX.
Use this to attach invoices, receipts, or supporting documents to journal entries.
Files must be in allowed directories and under 10MB.`,
    parameters: z4.object({
      organization_id: optionalOrganizationIdSchema.describe(
        "Zoho org ID (uses ZOHO_ORGANIZATION_ID env var if not provided)"
      ),
      journal_id: entityIdSchema.describe("Journal ID to attach file to"),
      file_path: z4.string().max(500).describe("Full local file path to the attachment")
    }),
    annotations: {
      title: "Add Journal Attachment",
      readOnlyHint: false,
      openWorldHint: true
    },
    execute: async (args) => {
      const result = await zohoUploadAttachment(
        `/journals/${args.journal_id}/attachment`,
        args.organization_id,
        args.file_path
      );
      if (!result.ok) {
        return result.errorMessage || "Failed to upload attachment";
      }
      return `**Attachment Added Successfully**

- **Journal ID**: \`${args.journal_id}\`
- **File**: ${args.file_path.split("/").pop()}

The attachment is now associated with this journal entry.`;
    }
  });
  server2.addTool({
    name: "get_journal_attachment",
    description: `Get attachment information for a journal entry.
Returns details about any files attached to the journal.`,
    parameters: z4.object({
      organization_id: optionalOrganizationIdSchema.describe(
        "Zoho org ID (uses ZOHO_ORGANIZATION_ID env var if not provided)"
      ),
      journal_id: entityIdSchema.describe("Journal ID")
    }),
    annotations: {
      title: "Get Journal Attachment",
      readOnlyHint: true,
      openWorldHint: true
    },
    execute: async (args) => {
      const result = await zohoGet(
        `/journals/${args.journal_id}/attachment`,
        args.organization_id
      );
      if (!result.ok) {
        return result.errorMessage || "Failed to get attachment";
      }
      const attachment = result.data?.attachment;
      const documents = result.data?.documents || [];
      if (!attachment && documents.length === 0) {
        return `No attachments found for journal \`${args.journal_id}\`.`;
      }
      let details = `**Journal Attachments**

- **Journal ID**: \`${args.journal_id}\`
`;
      if (attachment) {
        details += `
**Attachment**:
- File: ${attachment.file_name}
- Size: ${attachment.file_size_formatted || "Unknown"}`;
      }
      if (documents.length > 0) {
        details += `

**Documents** (${documents.length}):`;
        documents.forEach((doc, i) => {
          details += `
${i + 1}. ${doc.file_name} (${doc.file_size_formatted || "Unknown"})`;
        });
      }
      return details;
    }
  });
  server2.addTool({
    name: "delete_journal_attachment",
    description: `Delete attachment from a journal entry.
Removes the file association from the journal.`,
    parameters: z4.object({
      organization_id: optionalOrganizationIdSchema.describe(
        "Zoho org ID (uses ZOHO_ORGANIZATION_ID env var if not provided)"
      ),
      journal_id: entityIdSchema.describe("Journal ID")
    }),
    annotations: {
      title: "Delete Journal Attachment",
      readOnlyHint: false,
      openWorldHint: true
    },
    execute: async (args) => {
      const result = await zohoDeleteAttachment(
        `/journals/${args.journal_id}/attachment`,
        args.organization_id
      );
      if (!result.ok) {
        return result.errorMessage || "Failed to delete attachment";
      }
      return `**Attachment Deleted Successfully**

Attachment removed from journal \`${args.journal_id}\`.`;
    }
  });
}

// src/tools/expenses.ts
import { z as z5 } from "zod";
function registerExpenseTools(server2) {
  server2.addTool({
    name: "list_expenses",
    description: `List all expenses.
Supports filtering by date, status, and customer.
Returns expense details with account, amount, and vendor info.`,
    parameters: z5.object({
      organization_id: optionalOrganizationIdSchema.describe(
        "Zoho org ID (uses ZOHO_ORGANIZATION_ID env var if not provided)"
      ),
      date_start: optionalDateSchema.describe("Start date (YYYY-MM-DD)"),
      date_end: optionalDateSchema.describe("End date (YYYY-MM-DD)"),
      status: z5.enum(["unbilled", "invoiced", "reimbursed", "non-billable"]).optional().describe("Filter by status"),
      customer_id: entityIdSchema.optional().describe("Filter by customer"),
      vendor_id: entityIdSchema.optional().describe("Filter by vendor"),
      sort_column: z5.enum(["date", "amount", "created_time"]).optional(),
      page: z5.number().int().positive().optional(),
      per_page: z5.number().int().min(1).max(200).optional()
    }),
    annotations: {
      title: "List Expenses",
      readOnlyHint: true,
      openWorldHint: true
    },
    execute: async (args) => {
      const queryParams = {};
      if (args.date_start) queryParams.date_start = args.date_start;
      if (args.date_end) queryParams.date_end = args.date_end;
      if (args.status) queryParams.status = args.status;
      if (args.customer_id) queryParams.customer_id = args.customer_id;
      if (args.vendor_id) queryParams.vendor_id = args.vendor_id;
      if (args.sort_column) queryParams.sort_column = args.sort_column;
      if (args.page) queryParams.page = args.page.toString();
      if (args.per_page) queryParams.per_page = args.per_page.toString();
      const result = await zohoGet(
        "/expenses",
        args.organization_id,
        queryParams
      );
      if (!result.ok) {
        return result.errorMessage || "Failed to list expenses";
      }
      const expenses = result.data?.expenses || [];
      if (expenses.length === 0) {
        return "No expenses found.";
      }
      const formatted = expenses.map((e, index) => {
        return `${index + 1}. **${e.date}** - ${e.currency_code || ""} ${e.amount}
   - Expense ID: \`${e.expense_id}\`
   - Account: ${e.account_name || e.account_id}
   - Vendor: ${e.vendor_name || "N/A"}
   - Status: ${e.status || "N/A"}
   - Description: ${e.description || "N/A"}`;
      }).join("\n\n");
      return `**Expenses** (${expenses.length} items)

${formatted}`;
    }
  });
  server2.addTool({
    name: "get_expense",
    description: `Get detailed information about a specific expense.
Returns full expense details including account, vendor, and billable status.`,
    parameters: z5.object({
      organization_id: optionalOrganizationIdSchema.describe(
        "Zoho org ID (uses ZOHO_ORGANIZATION_ID env var if not provided)"
      ),
      expense_id: entityIdSchema.describe("Expense ID")
    }),
    annotations: {
      title: "Get Expense Details",
      readOnlyHint: true,
      openWorldHint: true
    },
    execute: async (args) => {
      const result = await zohoGet(
        `/expenses/${args.expense_id}`,
        args.organization_id
      );
      if (!result.ok) {
        return result.errorMessage || "Failed to get expense";
      }
      const expense = result.data?.expense;
      if (!expense) {
        return "Expense not found";
      }
      return `**Expense Details**

- **Expense ID**: \`${expense.expense_id}\`
- **Date**: ${expense.date}
- **Amount**: ${expense.currency_code || ""} ${expense.amount}
- **Account**: ${expense.account_name || expense.account_id}
- **Paid Through**: ${expense.paid_through_account_name || expense.paid_through_account_id || "N/A"}
- **Vendor**: ${expense.vendor_name || "N/A"}
- **Customer**: ${expense.customer_name || "N/A"}
- **Billable**: ${expense.is_billable ? "Yes" : "No"}
- **Status**: ${expense.status || "N/A"}
- **Reference**: ${expense.reference_number || "N/A"}
- **Description**: ${expense.description || "N/A"}`;
    }
  });
  server2.addTool({
    name: "create_expense",
    description: `Create a new expense record.
Requires account_id (expense account) and paid_through_account_id (payment account).
Use list_accounts to find valid account IDs.`,
    parameters: z5.object({
      organization_id: optionalOrganizationIdSchema.describe(
        "Zoho org ID (uses ZOHO_ORGANIZATION_ID env var if not provided)"
      ),
      account_id: entityIdSchema.describe("Expense account ID"),
      paid_through_account_id: entityIdSchema.describe(
        "Payment account ID (bank/cash/credit card)"
      ),
      date: dateSchema.describe("Expense date (YYYY-MM-DD)"),
      amount: moneySchema.describe("Expense amount (max 999,999,999.99, 2 decimal places)"),
      description: z5.string().max(500).optional().describe("Description of the expense"),
      reference_number: z5.string().max(100).optional().describe("Reference number"),
      customer_id: entityIdSchema.optional().describe("Customer ID if billable"),
      vendor_id: entityIdSchema.optional().describe("Vendor ID"),
      is_billable: z5.boolean().optional().describe("Whether expense is billable to a customer")
    }),
    annotations: {
      title: "Create Expense",
      readOnlyHint: false,
      openWorldHint: true
    },
    execute: async (args) => {
      const payload = {
        account_id: args.account_id,
        paid_through_account_id: args.paid_through_account_id,
        date: args.date,
        amount: args.amount
      };
      if (args.description) payload.description = args.description;
      if (args.reference_number) payload.reference_number = args.reference_number;
      if (args.customer_id) payload.customer_id = args.customer_id;
      if (args.vendor_id) payload.vendor_id = args.vendor_id;
      if (args.is_billable !== void 0) payload.is_billable = args.is_billable;
      const result = await zohoPost(
        "/expenses",
        args.organization_id,
        payload
      );
      if (!result.ok) {
        return result.errorMessage || "Failed to create expense";
      }
      const expense = result.data?.expense;
      if (!expense) {
        return "Expense created but no details returned";
      }
      return `**Expense Created Successfully**

- **Expense ID**: \`${expense.expense_id}\`
- **Date**: ${expense.date}
- **Amount**: ${expense.currency_code || ""} ${expense.amount}

Use this expense_id to add receipts.`;
    }
  });
  server2.addTool({
    name: "add_expense_receipt",
    description: `Upload a receipt attachment to an expense.
Supported file types: PDF, PNG, JPG, JPEG, GIF, DOC, DOCX, XLS, XLSX.
Use this to attach scanned receipts or invoice images.
Files must be in allowed directories and under 10MB.`,
    parameters: z5.object({
      organization_id: optionalOrganizationIdSchema.describe(
        "Zoho org ID (uses ZOHO_ORGANIZATION_ID env var if not provided)"
      ),
      expense_id: entityIdSchema.describe("Expense ID to attach receipt to"),
      file_path: z5.string().max(500).describe("Full local file path to the receipt")
    }),
    annotations: {
      title: "Add Expense Receipt",
      readOnlyHint: false,
      openWorldHint: true
    },
    execute: async (args) => {
      const result = await zohoUploadAttachment(
        `/expenses/${args.expense_id}/attachment`,
        args.organization_id,
        args.file_path
      );
      if (!result.ok) {
        return result.errorMessage || "Failed to upload receipt";
      }
      return `**Receipt Added Successfully**

- **Expense ID**: \`${args.expense_id}\`
- **File**: ${args.file_path.split("/").pop()}`;
    }
  });
  server2.addTool({
    name: "get_expense_receipt",
    description: `Get receipt/attachment information for an expense.
Returns details about any files attached to the expense.`,
    parameters: z5.object({
      organization_id: optionalOrganizationIdSchema.describe(
        "Zoho org ID (uses ZOHO_ORGANIZATION_ID env var if not provided)"
      ),
      expense_id: entityIdSchema.describe("Expense ID")
    }),
    annotations: {
      title: "Get Expense Receipt",
      readOnlyHint: true,
      openWorldHint: true
    },
    execute: async (args) => {
      const result = await zohoGet(
        `/expenses/${args.expense_id}/attachment`,
        args.organization_id
      );
      if (!result.ok) {
        return result.errorMessage || "Failed to get receipt";
      }
      const documents = result.data?.documents || [];
      if (documents.length === 0) {
        return `No receipts found for expense \`${args.expense_id}\`.`;
      }
      let details = `**Expense Receipts**

- **Expense ID**: \`${args.expense_id}\`

**Documents** (${documents.length}):`;
      documents.forEach((doc, i) => {
        details += `
${i + 1}. ${doc.file_name} (${doc.file_size_formatted || "Unknown"})`;
      });
      return details;
    }
  });
  server2.addTool({
    name: "delete_expense_receipt",
    description: `Delete receipt/attachment from an expense.
Removes the file association from the expense.`,
    parameters: z5.object({
      organization_id: optionalOrganizationIdSchema.describe(
        "Zoho org ID (uses ZOHO_ORGANIZATION_ID env var if not provided)"
      ),
      expense_id: entityIdSchema.describe("Expense ID")
    }),
    annotations: {
      title: "Delete Expense Receipt",
      readOnlyHint: false,
      openWorldHint: true
    },
    execute: async (args) => {
      const result = await zohoDeleteAttachment(
        `/expenses/${args.expense_id}/attachment`,
        args.organization_id
      );
      if (!result.ok) {
        return result.errorMessage || "Failed to delete receipt";
      }
      return `**Receipt Deleted Successfully**

Receipt removed from expense \`${args.expense_id}\`.`;
    }
  });
}

// src/tools/bills.ts
import { z as z6 } from "zod";
var billLineItemSchema = z6.object({
  account_id: z6.string().describe("Account ID from chart of accounts"),
  description: z6.string().optional().describe("Description for this line item"),
  amount: z6.number().positive().describe("Amount for this line item"),
  tax_id: z6.string().optional().describe("Tax ID if applicable")
});
function registerBillTools(server2) {
  server2.addTool({
    name: "list_bills",
    description: `List all bills (accounts payable).
Supports filtering by date, vendor, and status.
Returns bill details with vendor, amount, and due date.`,
    parameters: z6.object({
      organization_id: optionalOrganizationIdSchema.describe(
        "Zoho org ID (uses ZOHO_ORGANIZATION_ID env var if not provided)"
      ),
      date_start: z6.string().optional().describe("Start date (YYYY-MM-DD)"),
      date_end: z6.string().optional().describe("End date (YYYY-MM-DD)"),
      vendor_id: z6.string().optional().describe("Filter by vendor"),
      status: z6.enum(["draft", "open", "overdue", "paid", "void", "partially_paid"]).optional().describe("Filter by status"),
      sort_column: z6.enum(["date", "due_date", "total", "created_time"]).optional(),
      page: z6.number().int().positive().optional(),
      per_page: z6.number().int().min(1).max(200).optional()
    }),
    annotations: {
      title: "List Bills",
      readOnlyHint: true,
      openWorldHint: true
    },
    execute: async (args) => {
      const queryParams = {};
      if (args.date_start) queryParams.date_start = args.date_start;
      if (args.date_end) queryParams.date_end = args.date_end;
      if (args.vendor_id) queryParams.vendor_id = args.vendor_id;
      if (args.status) queryParams.status = args.status;
      if (args.sort_column) queryParams.sort_column = args.sort_column;
      if (args.page) queryParams.page = args.page.toString();
      if (args.per_page) queryParams.per_page = args.per_page.toString();
      const result = await zohoGet("/bills", args.organization_id, queryParams);
      if (!result.ok) {
        return result.errorMessage || "Failed to list bills";
      }
      const bills = result.data?.bills || [];
      if (bills.length === 0) {
        return "No bills found.";
      }
      const formatted = bills.map((b, index) => {
        return `${index + 1}. **${b.bill_number || "No number"}** - ${b.vendor_name || "Unknown vendor"}
   - Bill ID: \`${b.bill_id}\`
   - Date: ${b.date}
   - Due: ${b.due_date || "N/A"}
   - Total: ${b.currency_code || ""} ${b.total}
   - Balance: ${b.currency_code || ""} ${b.balance || 0}
   - Status: ${b.status || "N/A"}`;
      }).join("\n\n");
      return `**Bills** (${bills.length} items)

${formatted}`;
    }
  });
  server2.addTool({
    name: "get_bill",
    description: `Get detailed information about a specific bill.
Returns full bill details including line items and vendor info.`,
    parameters: z6.object({
      organization_id: optionalOrganizationIdSchema.describe(
        "Zoho org ID (uses ZOHO_ORGANIZATION_ID env var if not provided)"
      ),
      bill_id: z6.string().describe("Bill ID")
    }),
    annotations: {
      title: "Get Bill Details",
      readOnlyHint: true,
      openWorldHint: true
    },
    execute: async (args) => {
      const result = await zohoGet(`/bills/${args.bill_id}`, args.organization_id);
      if (!result.ok) {
        return result.errorMessage || "Failed to get bill";
      }
      const bill = result.data?.bill;
      if (!bill) {
        return "Bill not found";
      }
      let details = `**Bill Details**

- **Bill ID**: \`${bill.bill_id}\`
- **Bill Number**: ${bill.bill_number || "N/A"}
- **Vendor**: ${bill.vendor_name || bill.vendor_id}
- **Date**: ${bill.date}
- **Due Date**: ${bill.due_date || "N/A"}
- **Total**: ${bill.currency_code || ""} ${bill.total}
- **Balance**: ${bill.currency_code || ""} ${bill.balance || 0}
- **Status**: ${bill.status || "N/A"}
- **Reference**: ${bill.reference_number || "N/A"}
- **Notes**: ${bill.notes || "N/A"}

**Line Items**:`;
      if (bill.line_items && bill.line_items.length > 0) {
        bill.line_items.forEach((item, i) => {
          details += `
${i + 1}. ${item.account_name || item.account_id} - ${bill.currency_code || ""} ${item.amount}`;
          if (item.description) details += `
   Description: ${item.description}`;
        });
      }
      return details;
    }
  });
  server2.addTool({
    name: "create_bill",
    description: `Create a new bill (accounts payable).
Use list_contacts to find vendor_id values.
Use list_accounts to find account_id values for line items.`,
    parameters: z6.object({
      organization_id: optionalOrganizationIdSchema.describe(
        "Zoho org ID (uses ZOHO_ORGANIZATION_ID env var if not provided)"
      ),
      vendor_id: z6.string().describe("Vendor ID"),
      bill_number: z6.string().optional().describe("Bill/Invoice number from vendor"),
      date: z6.string().describe("Bill date (YYYY-MM-DD)"),
      due_date: z6.string().optional().describe("Payment due date (YYYY-MM-DD)"),
      reference_number: z6.string().optional().describe("Reference number"),
      notes: z6.string().optional().describe("Notes"),
      line_items: z6.array(billLineItemSchema).min(1).describe("Array of line items")
    }),
    annotations: {
      title: "Create Bill",
      readOnlyHint: false,
      openWorldHint: true
    },
    execute: async (args) => {
      const payload = {
        vendor_id: args.vendor_id,
        date: args.date,
        line_items: args.line_items
      };
      if (args.bill_number) payload.bill_number = args.bill_number;
      if (args.due_date) payload.due_date = args.due_date;
      if (args.reference_number) payload.reference_number = args.reference_number;
      if (args.notes) payload.notes = args.notes;
      const result = await zohoPost("/bills", args.organization_id, payload);
      if (!result.ok) {
        return result.errorMessage || "Failed to create bill";
      }
      const bill = result.data?.bill;
      if (!bill) {
        return "Bill created but no details returned";
      }
      return `**Bill Created Successfully**

- **Bill ID**: \`${bill.bill_id}\`
- **Bill Number**: ${bill.bill_number || "N/A"}
- **Date**: ${bill.date}
- **Total**: ${bill.currency_code || ""} ${bill.total}

Use this bill_id to add attachments.`;
    }
  });
  server2.addTool({
    name: "add_bill_attachment",
    description: `Upload a file attachment to a bill.
Supported file types: PDF, PNG, JPG, JPEG, GIF, DOC, DOCX, XLS, XLSX.
Use this to attach vendor invoices or supporting documents.`,
    parameters: z6.object({
      organization_id: optionalOrganizationIdSchema.describe(
        "Zoho org ID (uses ZOHO_ORGANIZATION_ID env var if not provided)"
      ),
      bill_id: z6.string().describe("Bill ID to attach file to"),
      file_path: z6.string().describe("Full local file path to the attachment")
    }),
    annotations: {
      title: "Add Bill Attachment",
      readOnlyHint: false,
      openWorldHint: true
    },
    execute: async (args) => {
      const result = await zohoUploadAttachment(
        `/bills/${args.bill_id}/attachment`,
        args.organization_id,
        args.file_path
      );
      if (!result.ok) {
        return result.errorMessage || "Failed to upload attachment";
      }
      return `**Attachment Added Successfully**

- **Bill ID**: \`${args.bill_id}\`
- **File**: ${args.file_path.split("/").pop()}`;
    }
  });
  server2.addTool({
    name: "get_bill_attachment",
    description: `Get attachment information for a bill.
Returns details about any files attached to the bill.`,
    parameters: z6.object({
      organization_id: optionalOrganizationIdSchema.describe(
        "Zoho org ID (uses ZOHO_ORGANIZATION_ID env var if not provided)"
      ),
      bill_id: z6.string().describe("Bill ID")
    }),
    annotations: {
      title: "Get Bill Attachment",
      readOnlyHint: true,
      openWorldHint: true
    },
    execute: async (args) => {
      const result = await zohoGet(
        `/bills/${args.bill_id}/attachment`,
        args.organization_id
      );
      if (!result.ok) {
        return result.errorMessage || "Failed to get attachment";
      }
      const documents = result.data?.documents || [];
      if (documents.length === 0) {
        return `No attachments found for bill \`${args.bill_id}\`.`;
      }
      let details = `**Bill Attachments**

- **Bill ID**: \`${args.bill_id}\`

**Documents** (${documents.length}):`;
      documents.forEach((doc, i) => {
        details += `
${i + 1}. ${doc.file_name} (${doc.file_size_formatted || "Unknown"})`;
      });
      return details;
    }
  });
  server2.addTool({
    name: "delete_bill_attachment",
    description: `Delete attachment from a bill.
Removes the file association from the bill.`,
    parameters: z6.object({
      organization_id: optionalOrganizationIdSchema.describe(
        "Zoho org ID (uses ZOHO_ORGANIZATION_ID env var if not provided)"
      ),
      bill_id: z6.string().describe("Bill ID")
    }),
    annotations: {
      title: "Delete Bill Attachment",
      readOnlyHint: false,
      openWorldHint: true
    },
    execute: async (args) => {
      const result = await zohoDeleteAttachment(
        `/bills/${args.bill_id}/attachment`,
        args.organization_id
      );
      if (!result.ok) {
        return result.errorMessage || "Failed to delete attachment";
      }
      return `**Attachment Deleted Successfully**

Attachment removed from bill \`${args.bill_id}\`.`;
    }
  });
}

// src/tools/invoices.ts
import { z as z7 } from "zod";
function registerInvoiceTools(server2) {
  server2.addTool({
    name: "list_invoices",
    description: `List all customer invoices (accounts receivable).
Supports filtering by date, customer, and status.
Returns invoice details with customer, amount, and due date.`,
    parameters: z7.object({
      organization_id: optionalOrganizationIdSchema.describe(
        "Zoho org ID (uses ZOHO_ORGANIZATION_ID env var if not provided)"
      ),
      date_start: z7.string().optional().describe("Start date (YYYY-MM-DD)"),
      date_end: z7.string().optional().describe("End date (YYYY-MM-DD)"),
      customer_id: z7.string().optional().describe("Filter by customer"),
      status: z7.enum(["draft", "sent", "overdue", "paid", "void", "partially_paid"]).optional().describe("Filter by status"),
      sort_column: z7.enum(["date", "due_date", "total", "created_time"]).optional(),
      page: z7.number().int().positive().optional(),
      per_page: z7.number().int().min(1).max(200).optional()
    }),
    annotations: {
      title: "List Invoices",
      readOnlyHint: true,
      openWorldHint: true
    },
    execute: async (args) => {
      const queryParams = {};
      if (args.date_start) queryParams.date_start = args.date_start;
      if (args.date_end) queryParams.date_end = args.date_end;
      if (args.customer_id) queryParams.customer_id = args.customer_id;
      if (args.status) queryParams.status = args.status;
      if (args.sort_column) queryParams.sort_column = args.sort_column;
      if (args.page) queryParams.page = args.page.toString();
      if (args.per_page) queryParams.per_page = args.per_page.toString();
      const result = await zohoGet(
        "/invoices",
        args.organization_id,
        queryParams
      );
      if (!result.ok) {
        return result.errorMessage || "Failed to list invoices";
      }
      const invoices = result.data?.invoices || [];
      if (invoices.length === 0) {
        return "No invoices found.";
      }
      const formatted = invoices.map((inv, index) => {
        return `${index + 1}. **${inv.invoice_number}** - ${inv.customer_name || "Unknown customer"}
   - Invoice ID: \`${inv.invoice_id}\`
   - Date: ${inv.date}
   - Due: ${inv.due_date || "N/A"}
   - Total: ${inv.currency_code || ""} ${inv.total}
   - Balance: ${inv.currency_code || ""} ${inv.balance || 0}
   - Status: ${inv.status || "N/A"}`;
      }).join("\n\n");
      return `**Invoices** (${invoices.length} items)

${formatted}`;
    }
  });
  server2.addTool({
    name: "get_invoice",
    description: `Get detailed information about a specific invoice.
Returns full invoice details including line items and customer info.`,
    parameters: z7.object({
      organization_id: optionalOrganizationIdSchema.describe(
        "Zoho org ID (uses ZOHO_ORGANIZATION_ID env var if not provided)"
      ),
      invoice_id: z7.string().describe("Invoice ID")
    }),
    annotations: {
      title: "Get Invoice Details",
      readOnlyHint: true,
      openWorldHint: true
    },
    execute: async (args) => {
      const result = await zohoGet(
        `/invoices/${args.invoice_id}`,
        args.organization_id
      );
      if (!result.ok) {
        return result.errorMessage || "Failed to get invoice";
      }
      const invoice = result.data?.invoice;
      if (!invoice) {
        return "Invoice not found";
      }
      let details = `**Invoice Details**

- **Invoice ID**: \`${invoice.invoice_id}\`
- **Invoice Number**: ${invoice.invoice_number}
- **Customer**: ${invoice.customer_name || invoice.customer_id}
- **Date**: ${invoice.date}
- **Due Date**: ${invoice.due_date || "N/A"}
- **Total**: ${invoice.currency_code || ""} ${invoice.total}
- **Balance**: ${invoice.currency_code || ""} ${invoice.balance || 0}
- **Status**: ${invoice.status || "N/A"}
- **Reference**: ${invoice.reference_number || "N/A"}
- **Notes**: ${invoice.notes || "N/A"}`;
      if (invoice.line_items && invoice.line_items.length > 0) {
        details += `

**Line Items**:`;
        invoice.line_items.forEach((item, i) => {
          details += `
${i + 1}. ${item.name || item.description || "Item"} - ${invoice.currency_code || ""} ${item.amount}`;
          if (item.quantity && item.rate) {
            details += ` (${item.quantity} x ${item.rate})`;
          }
        });
      }
      return details;
    }
  });
  server2.addTool({
    name: "add_invoice_attachment",
    description: `Upload a file attachment to an invoice.
Supported file types: PDF, PNG, JPG, JPEG, GIF, DOC, DOCX, XLS, XLSX.
Use this to attach supporting documents to invoices.`,
    parameters: z7.object({
      organization_id: optionalOrganizationIdSchema.describe(
        "Zoho org ID (uses ZOHO_ORGANIZATION_ID env var if not provided)"
      ),
      invoice_id: z7.string().describe("Invoice ID to attach file to"),
      file_path: z7.string().describe("Full local file path to the attachment")
    }),
    annotations: {
      title: "Add Invoice Attachment",
      readOnlyHint: false,
      openWorldHint: true
    },
    execute: async (args) => {
      const result = await zohoUploadAttachment(
        `/invoices/${args.invoice_id}/attachment`,
        args.organization_id,
        args.file_path
      );
      if (!result.ok) {
        return result.errorMessage || "Failed to upload attachment";
      }
      return `**Attachment Added Successfully**

- **Invoice ID**: \`${args.invoice_id}\`
- **File**: ${args.file_path.split("/").pop()}`;
    }
  });
  server2.addTool({
    name: "get_invoice_attachment",
    description: `Get attachment information for an invoice.
Returns details about any files attached to the invoice.`,
    parameters: z7.object({
      organization_id: optionalOrganizationIdSchema.describe(
        "Zoho org ID (uses ZOHO_ORGANIZATION_ID env var if not provided)"
      ),
      invoice_id: z7.string().describe("Invoice ID")
    }),
    annotations: {
      title: "Get Invoice Attachment",
      readOnlyHint: true,
      openWorldHint: true
    },
    execute: async (args) => {
      const result = await zohoGet(
        `/invoices/${args.invoice_id}/attachment`,
        args.organization_id
      );
      if (!result.ok) {
        return result.errorMessage || "Failed to get attachment";
      }
      const documents = result.data?.documents || [];
      if (documents.length === 0) {
        return `No attachments found for invoice \`${args.invoice_id}\`.`;
      }
      let details = `**Invoice Attachments**

- **Invoice ID**: \`${args.invoice_id}\`

**Documents** (${documents.length}):`;
      documents.forEach((doc, i) => {
        details += `
${i + 1}. ${doc.file_name} (${doc.file_size_formatted || "Unknown"})`;
      });
      return details;
    }
  });
  server2.addTool({
    name: "delete_invoice_attachment",
    description: `Delete attachment from an invoice.
Removes the file association from the invoice.`,
    parameters: z7.object({
      organization_id: optionalOrganizationIdSchema.describe(
        "Zoho org ID (uses ZOHO_ORGANIZATION_ID env var if not provided)"
      ),
      invoice_id: z7.string().describe("Invoice ID")
    }),
    annotations: {
      title: "Delete Invoice Attachment",
      readOnlyHint: false,
      openWorldHint: true
    },
    execute: async (args) => {
      const result = await zohoDeleteAttachment(
        `/invoices/${args.invoice_id}/attachment`,
        args.organization_id
      );
      if (!result.ok) {
        return result.errorMessage || "Failed to delete attachment";
      }
      return `**Attachment Deleted Successfully**

Attachment removed from invoice \`${args.invoice_id}\`.`;
    }
  });
}

// src/tools/contacts.ts
import { z as z8 } from "zod";
function registerContactTools(server2) {
  server2.addTool({
    name: "list_contacts",
    description: `List all contacts (customers and vendors).
Supports filtering by contact type (customer or vendor).
Use this to find contact_id values for bills, invoices, and expenses.`,
    parameters: z8.object({
      organization_id: optionalOrganizationIdSchema.describe(
        "Zoho org ID (uses ZOHO_ORGANIZATION_ID env var if not provided)"
      ),
      contact_type: z8.enum(["customer", "vendor"]).optional().describe("Filter by contact type"),
      status: z8.enum(["active", "inactive", "crm", "all"]).optional().describe("Filter by status"),
      search_text: z8.string().optional().describe("Search by name or company"),
      sort_column: z8.enum(["contact_name", "company_name", "created_time"]).optional(),
      page: z8.number().int().positive().optional(),
      per_page: z8.number().int().min(1).max(200).optional()
    }),
    annotations: {
      title: "List Contacts",
      readOnlyHint: true,
      openWorldHint: true
    },
    execute: async (args) => {
      const queryParams = {};
      if (args.contact_type) queryParams.contact_type = args.contact_type;
      if (args.status) queryParams.status = args.status;
      if (args.search_text) queryParams.search_text = args.search_text;
      if (args.sort_column) queryParams.sort_column = args.sort_column;
      if (args.page) queryParams.page = args.page.toString();
      if (args.per_page) queryParams.per_page = args.per_page.toString();
      const result = await zohoGet(
        "/contacts",
        args.organization_id,
        queryParams
      );
      if (!result.ok) {
        return result.errorMessage || "Failed to list contacts";
      }
      const contacts = result.data?.contacts || [];
      if (contacts.length === 0) {
        return "No contacts found.";
      }
      const formatted = contacts.map((c, index) => {
        return `${index + 1}. **${c.contact_name}** (${c.contact_type})
   - Contact ID: \`${c.contact_id}\`
   - Company: ${c.company_name || "N/A"}
   - Email: ${c.email || "N/A"}
   - Phone: ${c.phone || "N/A"}
   - Status: ${c.status}`;
      }).join("\n\n");
      return `**Contacts** (${contacts.length} items)

${formatted}`;
    }
  });
  server2.addTool({
    name: "get_contact",
    description: `Get detailed information about a specific contact.
Returns full contact details including payment terms and currency settings.`,
    parameters: z8.object({
      organization_id: optionalOrganizationIdSchema.describe(
        "Zoho org ID (uses ZOHO_ORGANIZATION_ID env var if not provided)"
      ),
      contact_id: z8.string().describe("Contact ID")
    }),
    annotations: {
      title: "Get Contact Details",
      readOnlyHint: true,
      openWorldHint: true
    },
    execute: async (args) => {
      const result = await zohoGet(
        `/contacts/${args.contact_id}`,
        args.organization_id
      );
      if (!result.ok) {
        return result.errorMessage || "Failed to get contact";
      }
      const contact = result.data?.contact;
      if (!contact) {
        return "Contact not found";
      }
      return `**Contact Details**

- **Contact ID**: \`${contact.contact_id}\`
- **Name**: ${contact.contact_name}
- **Type**: ${contact.contact_type}
- **Company**: ${contact.company_name || "N/A"}
- **Email**: ${contact.email || "N/A"}
- **Phone**: ${contact.phone || "N/A"}
- **Status**: ${contact.status}
- **Payment Terms**: ${contact.payment_terms ? `${contact.payment_terms} days` : "N/A"}
- **Currency**: ${contact.currency_code || "N/A"}`;
    }
  });
}

// src/tools/bank-accounts.ts
import { z as z9 } from "zod";
function registerBankAccountTools(server2) {
  server2.addTool({
    name: "list_bank_accounts",
    description: `List all bank accounts in Zoho Books.
Returns bank account details with name, type, and balance.
These are the accounts linked in Zoho Books, not live bank data.`,
    parameters: z9.object({
      organization_id: optionalOrganizationIdSchema.describe(
        "Zoho org ID (uses ZOHO_ORGANIZATION_ID env var if not provided)"
      ),
      filter_by: z9.enum(["Status.All", "Status.Active", "Status.Inactive"]).optional().describe("Filter by status"),
      sort_column: z9.enum(["account_name", "account_type"]).optional()
    }),
    annotations: {
      title: "List Bank Accounts",
      readOnlyHint: true,
      openWorldHint: true
    },
    execute: async (args) => {
      const queryParams = {};
      if (args.filter_by) queryParams.filter_by = args.filter_by;
      if (args.sort_column) queryParams.sort_column = args.sort_column;
      const result = await zohoGet(
        "/bankaccounts",
        args.organization_id,
        queryParams
      );
      if (!result.ok) {
        return result.errorMessage || "Failed to list bank accounts";
      }
      const accounts = result.data?.bankaccounts || [];
      if (accounts.length === 0) {
        return "No bank accounts found.";
      }
      const formatted = accounts.map((acc, index) => {
        const balance = acc.balance !== void 0 ? ` | Balance: ${acc.currency_code || ""} ${acc.balance}` : "";
        const digitsOnly = acc.account_number?.replace(/\D/g, "");
        const maskedAccount = digitsOnly && digitsOnly.length >= 4 ? `****${digitsOnly.slice(-4)}` : "N/A";
        return `${index + 1}. **${acc.account_name}** (${acc.account_type})
   - Account ID: \`${acc.account_id}\`
   - Bank: ${acc.bank_name || "N/A"}
   - Account Number: ${maskedAccount}
   - Active: ${acc.is_active ? "Yes" : "No"}${balance}`;
      }).join("\n\n");
      return `**Bank Accounts** (${accounts.length} accounts)

${formatted}`;
    }
  });
  server2.addTool({
    name: "get_bank_account",
    description: `Get detailed information about a specific bank account.
Returns full bank account details including routing number and balance.`,
    parameters: z9.object({
      organization_id: optionalOrganizationIdSchema.describe(
        "Zoho org ID (uses ZOHO_ORGANIZATION_ID env var if not provided)"
      ),
      account_id: entityIdSchema.describe("Bank account ID")
    }),
    annotations: {
      title: "Get Bank Account Details",
      readOnlyHint: true,
      openWorldHint: true
    },
    execute: async (args) => {
      const result = await zohoGet(
        `/bankaccounts/${args.account_id}`,
        args.organization_id
      );
      if (!result.ok) {
        return result.errorMessage || "Failed to get bank account";
      }
      const account = result.data?.bankaccount;
      if (!account) {
        return "Bank account not found";
      }
      const accountDigits = account.account_number?.replace(/\D/g, "");
      const maskedAccount = accountDigits && accountDigits.length >= 4 ? `****${accountDigits.slice(-4)}` : "N/A";
      const routingDigits = account.routing_number?.replace(/\D/g, "");
      const maskedRouting = routingDigits && routingDigits.length >= 4 ? `****${routingDigits.slice(-4)}` : "N/A";
      return `**Bank Account Details**

- **Account ID**: \`${account.account_id}\`
- **Name**: ${account.account_name}
- **Type**: ${account.account_type}
- **Code**: ${account.account_code || "N/A"}
- **Bank Name**: ${account.bank_name || "N/A"}
- **Account Number**: ${maskedAccount}
- **Routing Number**: ${maskedRouting}
- **Currency**: ${account.currency_code || "N/A"}
- **Balance**: ${account.currency_code || ""} ${account.balance || 0}
- **Active**: ${account.is_active ? "Yes" : "No"}`;
    }
  });
  server2.addTool({
    name: "list_bank_transactions",
    description: `List bank transactions in Zoho Books.
Returns transactions recorded in Zoho Books for bank reconciliation.
These are transactions imported/entered in Zoho, not live bank feeds.`,
    parameters: z9.object({
      organization_id: optionalOrganizationIdSchema.describe(
        "Zoho org ID (uses ZOHO_ORGANIZATION_ID env var if not provided)"
      ),
      account_id: entityIdSchema.describe("Bank account ID"),
      date_start: optionalDateSchema.describe("Start date (YYYY-MM-DD)"),
      date_end: optionalDateSchema.describe("End date (YYYY-MM-DD)"),
      status: z9.enum(["All", "uncategorized", "categorized", "excluded"]).optional(),
      sort_column: z9.enum(["date", "amount"]).optional(),
      page: z9.number().int().positive().optional(),
      per_page: z9.number().int().min(1).max(200).optional()
    }),
    annotations: {
      title: "List Bank Transactions",
      readOnlyHint: true,
      openWorldHint: true
    },
    execute: async (args) => {
      const queryParams = {
        account_id: args.account_id
      };
      if (args.date_start) queryParams.date_start = args.date_start;
      if (args.date_end) queryParams.date_end = args.date_end;
      if (args.status) queryParams.status = args.status;
      if (args.sort_column) queryParams.sort_column = args.sort_column;
      if (args.page) queryParams.page = args.page.toString();
      if (args.per_page) queryParams.per_page = args.per_page.toString();
      const result = await zohoGet(
        "/banktransactions",
        args.organization_id,
        queryParams
      );
      if (!result.ok) {
        return result.errorMessage || "Failed to list bank transactions";
      }
      const transactions = result.data?.banktransactions || [];
      if (transactions.length === 0) {
        return "No bank transactions found.";
      }
      const formatted = transactions.map((tx, index) => {
        const amount = tx.debit_or_credit === "debit" ? `-${tx.amount}` : `+${tx.amount}`;
        return `${index + 1}. **${tx.date}** - ${tx.currency_code || ""} ${amount}
   - Transaction ID: \`${tx.transaction_id}\`
   - Type: ${tx.transaction_type}
   - Status: ${tx.status}
   - Payee: ${tx.payee || "N/A"}
   - Reference: ${tx.reference_number || "N/A"}
   - Description: ${tx.description || "N/A"}`;
      }).join("\n\n");
      return `**Bank Transactions** (${transactions.length} transactions)

${formatted}`;
    }
  });
}

// src/index.ts
var server = new FastMCP({
  name: "zoho-bookkeeper-mcp",
  version: "1.0.0",
  instructions: `
Zoho Books MCP server for bookkeeping workflows.

## Getting Started
1. First use \`list_organizations\` to get your organization_id
2. Use that organization_id for all subsequent API calls

## Available Tool Categories

### Organizations (2 tools)
- list_organizations: List all Zoho organizations (use first to get org_id)
- get_organization: Get organization details

### Chart of Accounts (4 tools)
- list_accounts: List all accounts (find account_id values here)
- get_account: Get account details
- create_account: Create new account
- list_account_transactions: List transactions for an account

### Journals (9 tools)
- list_journals: List journal entries
- get_journal: Get journal details
- create_journal: Create journal entry (debits must equal credits)
- update_journal: Update journal entry
- delete_journal: Delete journal entry
- publish_journal: Publish/post a draft journal
- add_journal_attachment: Upload file to journal
- get_journal_attachment: Get journal attachment info
- delete_journal_attachment: Remove journal attachment

### Expenses (6 tools)
- list_expenses: List expenses
- get_expense: Get expense details
- create_expense: Create expense
- add_expense_receipt: Upload receipt to expense
- get_expense_receipt: Get expense receipt info
- delete_expense_receipt: Remove expense receipt

### Bills (6 tools)
- list_bills: List bills (accounts payable)
- get_bill: Get bill details
- create_bill: Create bill
- add_bill_attachment: Upload file to bill
- get_bill_attachment: Get bill attachment info
- delete_bill_attachment: Remove bill attachment

### Invoices (5 tools)
- list_invoices: List invoices (accounts receivable)
- get_invoice: Get invoice details
- add_invoice_attachment: Upload file to invoice
- get_invoice_attachment: Get invoice attachment info
- delete_invoice_attachment: Remove invoice attachment

### Contacts (2 tools)
- list_contacts: List customers and vendors
- get_contact: Get contact details

### Bank Accounts (3 tools)
- list_bank_accounts: List bank accounts in Zoho
- get_bank_account: Get bank account details
- list_bank_transactions: List bank transactions

## Common Workflows

### Create a Journal Entry with Receipt
1. list_organizations -> get organization_id
2. list_accounts -> find account_id values
3. create_journal -> create the entry (balanced debits/credits)
4. add_journal_attachment -> attach the receipt file

### Record an Expense with Receipt
1. list_organizations -> get organization_id
2. list_accounts -> find expense account_id and payment account_id
3. create_expense -> record the expense
4. add_expense_receipt -> attach the receipt

### Create a Bill from Vendor
1. list_organizations -> get organization_id
2. list_contacts with contact_type="vendor" -> find vendor_id
3. list_accounts -> find expense account_id
4. create_bill -> create the bill
5. add_bill_attachment -> attach the vendor invoice
`,
  health: {
    enabled: true,
    message: JSON.stringify({
      status: "healthy",
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      version: "1.0.0",
      service: "zoho-bookkeeper-mcp"
    }),
    path: "/health",
    status: 200
  }
});
registerOrganizationTools(server);
registerChartOfAccountsTools(server);
registerJournalTools(server);
registerExpenseTools(server);
registerBillTools(server);
registerInvoiceTools(server);
registerContactTools(server);
registerBankAccountTools(server);
var src_default = server;

export {
  getServerConfig,
  src_default
};
