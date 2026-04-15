/**
 * Vendor tools for Zoho Books API
 */

import { z } from "zod"
import type { FastMCP } from "fastmcp"
import { zohoGet, zohoPost, zohoPut } from "../api/client.js"
import type { Contact, ContactAddress } from "../api/types.js"
import { entityIdSchema, optionalOrganizationIdSchema } from "../utils/validation.js"

const vendorAddressSchema = z
  .object({
    attention: z.string().max(100).optional().describe("Optional billing address attention line"),
    address: z.string().max(500).optional().describe("Optional billing address line 1"),
    street2: z.string().max(255).optional().describe("Optional billing address line 2"),
    city: z.string().max(100).optional().describe("Optional billing address city"),
    state: z.string().max(100).optional().describe("Optional billing address state or province"),
    state_code: z.string().max(100).optional().describe("Optional billing address state code"),
    zip: z.string().max(50).optional().describe("Optional billing address postal or ZIP code"),
    country: z.string().max(100).optional().describe("Optional billing address country"),
    fax: z.string().max(50).optional().describe("Optional billing address fax number"),
    phone: z.string().max(50).optional().describe("Optional billing address phone number"),
  })
  .strict()

function formatAddress(address?: ContactAddress): string {
  if (!address) return "N/A"

  const parts = [
    address.attention,
    address.address,
    address.street2,
    address.city,
    address.state,
    address.state_code,
    address.zip,
    address.country,
  ].filter(Boolean)

  return parts.length > 0 ? parts.join(", ") : "N/A"
}

function escapeMarkdownText(value?: string): string {
  if (!value) return "N/A"

  return value
    .replace(/\\/g, "\\\\")
    .replace(/([`*_{}[\]()#+\-.!|>])/g, "\\$1")
    .replace(/\r?\n/g, " ")
}

/**
 * Register vendor tools on the server
 */
export function registerVendorTools(server: FastMCP): void {
  // List Vendors
  server.addTool({
    name: "list_vendors",
    description: `List vendor contacts only.
Use this to find vendor_id values for expenses, bills, and vendor-payment bank categorization workflows.`,
    parameters: z
      .object({
        organization_id: optionalOrganizationIdSchema.describe(
          "Zoho org ID (uses ZOHO_ORGANIZATION_ID env var if not provided)"
        ),
        status: z
          .enum(["active", "inactive", "crm", "all"])
          .optional()
          .describe("Filter by status"),
        search_text: z.string().max(100).optional().describe("Search by vendor name or company"),
        sort_column: z.enum(["contact_name", "company_name", "created_time"]).optional(),
        page: z.number().int().positive().optional(),
        per_page: z.number().int().min(1).max(200).optional(),
      })
      .strict(),
    annotations: {
      title: "List Vendors",
      readOnlyHint: true,
      openWorldHint: true,
    },
    execute: async (args) => {
      const queryParams: Record<string, string> = {
        contact_type: "vendor",
      }
      if (args.status) queryParams.status = args.status
      if (args.search_text) queryParams.search_text = args.search_text
      if (args.sort_column) queryParams.sort_column = args.sort_column
      if (args.page) queryParams.page = args.page.toString()
      if (args.per_page) queryParams.per_page = args.per_page.toString()

      const result = await zohoGet<{ contacts: Contact[] }>(
        "/contacts",
        args.organization_id,
        queryParams
      )

      if (!result.ok) {
        return result.errorMessage || "Failed to list vendors"
      }

      const vendors = (result.data?.contacts || []).filter(
        (contact) => contact.contact_type === "vendor"
      )

      if (vendors.length === 0) {
        return "No vendors found."
      }

      const formatted = vendors
        .map((vendor, index) => {
          return `${index + 1}. **${vendor.contact_name}**
   - Vendor ID: \`${vendor.contact_id}\`
   - Company: ${vendor.company_name || "N/A"}
   - Email: ${vendor.email || "N/A"}
   - Phone: ${vendor.phone || "N/A"}
   - Status: ${vendor.status}`
        })
        .join("\n\n")

      return `**Vendors** (${vendors.length} items)\n\n${formatted}`
    },
  })

  // Get Vendor
  server.addTool({
    name: "get_vendor",
    description: `Get detailed information about a specific vendor.
Use this to confirm a vendor_id before creating expenses, bills, or vendor-payment categorizations.`,
    parameters: z
      .object({
        organization_id: optionalOrganizationIdSchema.describe(
          "Zoho org ID (uses ZOHO_ORGANIZATION_ID env var if not provided)"
        ),
        vendor_id: entityIdSchema.describe("Vendor ID (contact_id in Zoho Books)"),
      })
      .strict(),
    annotations: {
      title: "Get Vendor Details",
      readOnlyHint: true,
      openWorldHint: true,
    },
    execute: async (args) => {
      const result = await zohoGet<{ contact: Contact }>(
        `/contacts/${args.vendor_id}`,
        args.organization_id
      )

      if (!result.ok) {
        return result.errorMessage || "Failed to get vendor"
      }

      const vendor = result.data?.contact

      if (!vendor) {
        return "Vendor not found"
      }

      if (vendor.contact_type !== "vendor") {
        return "Contact is not a vendor"
      }

      return `**Vendor Details**

- **Vendor ID**: \`${vendor.contact_id}\`
- **Name**: ${vendor.contact_name}
- **Company**: ${vendor.company_name || "N/A"}
- **Email**: ${vendor.email || "N/A"}
- **Phone**: ${vendor.phone || "N/A"}
- **Status**: ${vendor.status}
- **Payment Terms**: ${vendor.payment_terms !== undefined ? `${vendor.payment_terms} days` : "N/A"}
- **Currency**: ${vendor.currency_code || "N/A"}
- **Billing Address**: ${formatAddress(vendor.billing_address)}
- **Notes**: ${escapeMarkdownText(vendor.notes)}`
    },
  })

  // Create Vendor
  server.addTool({
    name: "create_vendor",
    description: `Create a new vendor contact.
Use this when expense, bill, or vendor-payment workflows need a vendor_id that does not exist yet in Zoho Books.`,
    parameters: z
      .object({
        organization_id: optionalOrganizationIdSchema.describe(
          "Zoho org ID (uses ZOHO_ORGANIZATION_ID env var if not provided)"
        ),
        contact_name: z.string().max(200).describe("Vendor display name in Zoho Books"),
        company_name: z.string().max(200).optional().describe("Optional legal or company name"),
        email: z
          .string()
          .email("Invalid email address")
          .max(320)
          .optional()
          .describe("Optional vendor email"),
        phone: z.string().max(50).optional().describe("Optional vendor phone number"),
        currency_id: entityIdSchema.optional().describe("Optional currency ID"),
        payment_terms: z
          .number()
          .int()
          .min(0)
          .max(3650)
          .optional()
          .describe("Optional payment terms in days"),
        billing_address: vendorAddressSchema.optional().describe("Optional billing address"),
        notes: z.string().max(2000).optional().describe("Optional internal notes for the vendor"),
      })
      .strict(),
    annotations: {
      title: "Create Vendor",
      readOnlyHint: false,
      openWorldHint: true,
    },
    execute: async (args) => {
      const payload: Record<string, unknown> = {
        contact_name: args.contact_name,
        contact_type: "vendor",
      }

      if (args.company_name) payload.company_name = args.company_name
      if (args.email) payload.email = args.email
      if (args.phone) payload.phone = args.phone
      if (args.currency_id) payload.currency_id = args.currency_id
      if (args.payment_terms !== undefined) payload.payment_terms = args.payment_terms
      if (args.billing_address) payload.billing_address = args.billing_address
      if (args.notes) payload.notes = args.notes

      const result = await zohoPost<{ contact: Contact }>(
        "/contacts",
        args.organization_id,
        payload
      )

      if (!result.ok) {
        return result.errorMessage || "Failed to create vendor"
      }

      const vendor = result.data?.contact

      if (!vendor) {
        return "Vendor created but no details returned"
      }

      return `**Vendor Created Successfully**

- **Vendor ID**: \`${vendor.contact_id}\`
- **Name**: ${vendor.contact_name}
- **Company**: ${vendor.company_name || "N/A"}
- **Email**: ${vendor.email || "N/A"}
- **Phone**: ${vendor.phone || "N/A"}

Use this vendor_id for expenses, bills, and vendor-payment categorizations.`
    },
  })

  // Update Vendor
  server.addTool({
    name: "update_vendor",
    description: `Update an existing vendor contact.
Use this to correct or enrich vendor details needed for expenses, bills, and vendor-payment workflows.`,
    parameters: z
      .object({
        organization_id: optionalOrganizationIdSchema.describe(
          "Zoho org ID (uses ZOHO_ORGANIZATION_ID env var if not provided)"
        ),
        vendor_id: entityIdSchema.describe("Vendor ID (contact_id in Zoho Books)"),
        contact_name: z.string().max(200).optional().describe("New vendor display name"),
        company_name: z.string().max(200).optional().describe("New legal or company name"),
        email: z
          .string()
          .email("Invalid email address")
          .max(320)
          .optional()
          .describe("New vendor email"),
        phone: z.string().max(50).optional().describe("New vendor phone number"),
        currency_id: entityIdSchema.optional().describe("New currency ID"),
        payment_terms: z
          .number()
          .int()
          .min(0)
          .max(3650)
          .optional()
          .describe("New payment terms in days"),
        billing_address: vendorAddressSchema.optional().describe("New billing address"),
        notes: z.string().max(2000).optional().describe("New internal notes for the vendor"),
      })
      .strict(),
    annotations: {
      title: "Update Vendor",
      readOnlyHint: false,
      openWorldHint: true,
    },
    execute: async (args) => {
      const payload: Record<string, unknown> = {}

      if (args.contact_name) payload.contact_name = args.contact_name
      if (args.company_name) payload.company_name = args.company_name
      if (args.email) payload.email = args.email
      if (args.phone) payload.phone = args.phone
      if (args.currency_id) payload.currency_id = args.currency_id
      if (args.payment_terms !== undefined) payload.payment_terms = args.payment_terms
      if (args.billing_address) payload.billing_address = args.billing_address
      if (args.notes) payload.notes = args.notes

      if (Object.keys(payload).length === 0) {
        return "**Validation Error**: Provide at least one vendor field to update."
      }

      const result = await zohoPut<{ contact: Contact }>(
        `/contacts/${args.vendor_id}`,
        args.organization_id,
        payload
      )

      if (!result.ok) {
        return result.errorMessage || "Failed to update vendor"
      }

      const vendor = result.data?.contact

      if (!vendor) {
        return `**Vendor Updated Successfully**\n\nVendor ID: \`${args.vendor_id}\``
      }

      return `**Vendor Updated Successfully**

- **Vendor ID**: \`${vendor.contact_id}\`
- **Name**: ${vendor.contact_name}
- **Company**: ${vendor.company_name || "N/A"}
- **Email**: ${vendor.email || "N/A"}
- **Phone**: ${vendor.phone || "N/A"}`
    },
  })
}
