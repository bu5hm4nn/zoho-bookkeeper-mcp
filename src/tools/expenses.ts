/**
 * Expense tools for Zoho Books API
 */

import { z } from "zod"
import type { FastMCP } from "fastmcp"
import {
  zohoGet,
  zohoPost,
  zohoPut,
  zohoDelete,
  zohoUploadAttachment,
  zohoDeleteAttachment,
} from "../api/client.js"
import type { Expense, Attachment } from "../api/types.js"
import {
  moneySchema,
  entityIdSchema,
  dateSchema,
  optionalDateSchema,
  optionalOrganizationIdSchema,
} from "../utils/validation.js"

/**
 * Register expense tools on the server
 */
export function registerExpenseTools(server: FastMCP): void {
  // List Expenses
  server.addTool({
    name: "list_expenses",
    description: `List all expenses.
Supports filtering by date, status, and customer.
Returns expense details with account, amount, and vendor info.`,
    parameters: z.object({
      organization_id: optionalOrganizationIdSchema.describe(
        "Zoho org ID (uses ZOHO_ORGANIZATION_ID env var if not provided)"
      ),
      date_start: optionalDateSchema.describe("Start date (YYYY-MM-DD)"),
      date_end: optionalDateSchema.describe("End date (YYYY-MM-DD)"),
      status: z
        .enum(["unbilled", "invoiced", "reimbursed", "non-billable"])
        .optional()
        .describe("Filter by status"),
      customer_id: entityIdSchema.optional().describe("Filter by customer"),
      vendor_id: entityIdSchema.optional().describe("Filter by vendor"),
      sort_column: z.enum(["date", "amount", "created_time"]).optional(),
      page: z.number().int().positive().optional(),
      per_page: z.number().int().min(1).max(200).optional(),
    }),
    annotations: {
      title: "List Expenses",
      readOnlyHint: true,
      openWorldHint: true,
    },
    execute: async (args) => {
      const queryParams: Record<string, string> = {}
      if (args.date_start) queryParams.date_start = args.date_start
      if (args.date_end) queryParams.date_end = args.date_end
      if (args.status) queryParams.status = args.status
      if (args.customer_id) queryParams.customer_id = args.customer_id
      if (args.vendor_id) queryParams.vendor_id = args.vendor_id
      if (args.sort_column) queryParams.sort_column = args.sort_column
      if (args.page) queryParams.page = args.page.toString()
      if (args.per_page) queryParams.per_page = args.per_page.toString()

      const result = await zohoGet<{ expenses: Expense[] }>(
        "/expenses",
        args.organization_id,
        queryParams
      )

      if (!result.ok) {
        return result.errorMessage || "Failed to list expenses"
      }

      const expenses = result.data?.expenses || []

      if (expenses.length === 0) {
        return "No expenses found."
      }

      const formatted = expenses
        .map((e, index) => {
          return `${index + 1}. **${e.date}** - ${e.currency_code || ""} ${e.amount}
   - Expense ID: \`${e.expense_id}\`
   - Account: ${e.account_name || e.account_id}
   - Vendor: ${e.vendor_name || "N/A"}
   - Status: ${e.status || "N/A"}
   - Description: ${e.description || "N/A"}`
        })
        .join("\n\n")

      return `**Expenses** (${expenses.length} items)\n\n${formatted}`
    },
  })

  // Get Expense
  server.addTool({
    name: "get_expense",
    description: `Get detailed information about a specific expense.
Returns full expense details including account, vendor, and billable status.`,
    parameters: z.object({
      organization_id: optionalOrganizationIdSchema.describe(
        "Zoho org ID (uses ZOHO_ORGANIZATION_ID env var if not provided)"
      ),
      expense_id: entityIdSchema.describe("Expense ID"),
    }),
    annotations: {
      title: "Get Expense Details",
      readOnlyHint: true,
      openWorldHint: true,
    },
    execute: async (args) => {
      const result = await zohoGet<{ expense: Expense }>(
        `/expenses/${args.expense_id}`,
        args.organization_id
      )

      if (!result.ok) {
        return result.errorMessage || "Failed to get expense"
      }

      const expense = result.data?.expense

      if (!expense) {
        return "Expense not found"
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
- **Description**: ${expense.description || "N/A"}`
    },
  })

  // Create Expense
  server.addTool({
    name: "create_expense",
    description: `Create a new expense record. Supports both regular expenses and mileage expenses.
Requires account_id (expense account) and paid_through_account_id (payment account).
Use list_accounts to find valid account IDs.

For mileage expenses, set mileage_type to "manual" with distance + mileage_unit + mileage_rate,
or set mileage_type to "odometer" with start_reading + end_reading + mileage_rate.
Zoho will auto-calculate the amount from mileage fields. Do NOT provide amount for mileage expenses.`,
    parameters: z
      .object({
        organization_id: optionalOrganizationIdSchema.describe(
          "Zoho org ID (uses ZOHO_ORGANIZATION_ID env var if not provided)"
        ),
        account_id: entityIdSchema.describe("Expense account ID"),
        paid_through_account_id: entityIdSchema.describe(
          "Payment account ID (bank/cash/credit card)"
        ),
        date: dateSchema.describe("Expense date (YYYY-MM-DD)"),
        amount: moneySchema
          .optional()
          .describe(
            "Expense amount — required for regular expenses, omit for mileage (auto-calculated)"
          ),
        description: z.string().max(500).optional().describe("Description of the expense"),
        reference_number: z.string().max(100).optional().describe("Reference number"),
        customer_id: entityIdSchema.optional().describe("Customer ID if billable"),
        vendor_id: entityIdSchema.optional().describe("Vendor ID"),
        is_billable: z.boolean().optional().describe("Whether expense is billable to a customer"),
        mileage_type: z
          .enum(["manual", "odometer"])
          .optional()
          .describe("Mileage type: 'manual' (enter distance) or 'odometer' (enter readings)"),
        distance: z
          .number()
          .positive()
          .optional()
          .describe("Distance travelled (required when mileage_type is 'manual')"),
        mileage_unit: z
          .enum(["km", "mile"])
          .optional()
          .describe("Unit of distance: 'km' or 'mile'"),
        mileage_rate: z.number().positive().optional().describe("Rate per unit distance"),
        start_reading: z
          .number()
          .nonnegative()
          .optional()
          .describe("Odometer start reading (required when mileage_type is 'odometer')"),
        end_reading: z
          .number()
          .positive()
          .optional()
          .describe("Odometer end reading (required when mileage_type is 'odometer')"),
      })
      .strict()
      .superRefine((args, ctx) => {
        const hasMileageFields =
          args.distance !== undefined ||
          args.mileage_unit !== undefined ||
          args.mileage_rate !== undefined ||
          args.start_reading !== undefined ||
          args.end_reading !== undefined

        if (!args.mileage_type && hasMileageFields) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "mileage_type is required when providing mileage fields",
            path: ["mileage_type"],
          })
        }

        if (args.mileage_type === "manual") {
          if (args.distance === undefined)
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "distance is required when mileage_type is 'manual'",
              path: ["distance"],
            })
          if (!args.mileage_unit)
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "mileage_unit is required when mileage_type is 'manual'",
              path: ["mileage_unit"],
            })
          if (args.mileage_rate === undefined)
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "mileage_rate is required when mileage_type is 'manual'",
              path: ["mileage_rate"],
            })
        }
        if (args.mileage_type === "odometer") {
          if (args.start_reading === undefined)
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "start_reading is required when mileage_type is 'odometer'",
              path: ["start_reading"],
            })
          if (args.end_reading === undefined)
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "end_reading is required when mileage_type is 'odometer'",
              path: ["end_reading"],
            })
          if (args.mileage_rate === undefined)
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "mileage_rate is required when mileage_type is 'odometer'",
              path: ["mileage_rate"],
            })
          if (
            args.start_reading !== undefined &&
            args.end_reading !== undefined &&
            args.end_reading <= args.start_reading
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "end_reading must be greater than start_reading",
              path: ["end_reading"],
            })
          }
        }
        if (args.mileage_type && args.amount !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Do not provide amount for mileage expenses — Zoho auto-calculates it",
            path: ["amount"],
          })
        }
        if (!args.mileage_type && args.amount === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "amount is required for non-mileage expenses",
            path: ["amount"],
          })
        }
      }),
    annotations: {
      title: "Create Expense",
      readOnlyHint: false,
      openWorldHint: true,
    },
    execute: async (args) => {
      const payload: Record<string, unknown> = {
        account_id: args.account_id,
        paid_through_account_id: args.paid_through_account_id,
        date: args.date,
      }

      if (args.amount !== undefined) payload.amount = args.amount
      if (args.description) payload.description = args.description
      if (args.reference_number) payload.reference_number = args.reference_number
      if (args.customer_id) payload.customer_id = args.customer_id
      if (args.vendor_id) payload.vendor_id = args.vendor_id
      if (args.is_billable !== undefined) payload.is_billable = args.is_billable

      // Mileage fields
      if (args.mileage_type) payload.mileage_type = args.mileage_type
      if (args.distance !== undefined) payload.distance = args.distance
      if (args.mileage_unit) payload.mileage_unit = args.mileage_unit
      if (args.mileage_rate !== undefined) payload.mileage_rate = args.mileage_rate
      if (args.start_reading !== undefined) payload.start_reading = args.start_reading
      if (args.end_reading !== undefined) payload.end_reading = args.end_reading

      const result = await zohoPost<{ expense: Expense }>(
        "/expenses",
        args.organization_id,
        payload
      )

      if (!result.ok) {
        return result.errorMessage || "Failed to create expense"
      }

      const expense = result.data?.expense

      if (!expense) {
        return "Expense created but no details returned"
      }

      const mileageInfo = expense.distance
        ? `\n- **Distance**: ${expense.distance} ${expense.mileage_unit || ""}`
        : ""

      return `**Expense Created Successfully**

- **Expense ID**: \`${expense.expense_id}\`
- **Date**: ${expense.date}
- **Amount**: ${expense.currency_code || ""} ${expense.amount}${mileageInfo}

Use this expense_id to add receipts.`
    },
  })

  // Update Expense
  server.addTool({
    name: "update_expense",
    description: `Update an existing expense record. Supports both regular and mileage expenses.
Only provide fields you want to change — unspecified fields remain unchanged.

For mileage expenses, set mileage_type to "manual" with distance + mileage_unit + mileage_rate,
or set mileage_type to "odometer" with start_reading + end_reading + mileage_rate.
Zoho will auto-calculate the amount from mileage fields.`,
    parameters: z
      .object({
        organization_id: optionalOrganizationIdSchema.describe(
          "Zoho org ID (uses ZOHO_ORGANIZATION_ID env var if not provided)"
        ),
        expense_id: entityIdSchema.describe("Expense ID to update"),
        account_id: entityIdSchema.optional().describe("Expense account ID"),
        paid_through_account_id: entityIdSchema
          .optional()
          .describe("Payment account ID (bank/cash/credit card)"),
        date: dateSchema.optional().describe("Expense date (YYYY-MM-DD)"),
        amount: moneySchema.optional().describe("Expense amount"),
        description: z.string().max(500).optional().describe("Description of the expense"),
        reference_number: z.string().max(100).optional().describe("Reference number"),
        customer_id: entityIdSchema.optional().describe("Customer ID if billable"),
        vendor_id: entityIdSchema.optional().describe("Vendor ID"),
        is_billable: z.boolean().optional().describe("Whether expense is billable to a customer"),
        mileage_type: z
          .enum(["manual", "odometer"])
          .optional()
          .describe("Mileage type: 'manual' (enter distance) or 'odometer' (enter readings)"),
        distance: z
          .number()
          .positive()
          .optional()
          .describe("Distance travelled (required when mileage_type is 'manual')"),
        mileage_unit: z
          .enum(["km", "mile"])
          .optional()
          .describe("Unit of distance: 'km' or 'mile'"),
        mileage_rate: z.number().positive().optional().describe("Rate per unit distance"),
        start_reading: z
          .number()
          .nonnegative()
          .optional()
          .describe("Odometer start reading (required when mileage_type is 'odometer')"),
        end_reading: z
          .number()
          .positive()
          .optional()
          .describe("Odometer end reading (required when mileage_type is 'odometer')"),
      })
      .strict()
      .superRefine((args, ctx) => {
        const hasMileageFields =
          args.distance !== undefined ||
          args.mileage_unit !== undefined ||
          args.mileage_rate !== undefined ||
          args.start_reading !== undefined ||
          args.end_reading !== undefined

        if (!args.mileage_type && hasMileageFields) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "mileage_type is required when providing mileage fields",
            path: ["mileage_type"],
          })
        }

        if (args.mileage_type === "manual") {
          if (args.distance === undefined)
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "distance is required when mileage_type is 'manual'",
              path: ["distance"],
            })
          if (!args.mileage_unit)
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "mileage_unit is required when mileage_type is 'manual'",
              path: ["mileage_unit"],
            })
          if (args.mileage_rate === undefined)
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "mileage_rate is required when mileage_type is 'manual'",
              path: ["mileage_rate"],
            })
        }
        if (args.mileage_type === "odometer") {
          if (args.start_reading === undefined)
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "start_reading is required when mileage_type is 'odometer'",
              path: ["start_reading"],
            })
          if (args.end_reading === undefined)
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "end_reading is required when mileage_type is 'odometer'",
              path: ["end_reading"],
            })
          if (args.mileage_rate === undefined)
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "mileage_rate is required when mileage_type is 'odometer'",
              path: ["mileage_rate"],
            })
          if (
            args.start_reading !== undefined &&
            args.end_reading !== undefined &&
            args.end_reading <= args.start_reading
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "end_reading must be greater than start_reading",
              path: ["end_reading"],
            })
          }
        }
        if (args.mileage_type && args.amount !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Do not provide amount for mileage expenses — Zoho auto-calculates it",
            path: ["amount"],
          })
        }
      }),
    annotations: {
      title: "Update Expense",
      readOnlyHint: false,
      openWorldHint: true,
    },
    execute: async (args) => {
      const payload: Record<string, unknown> = {}

      if (args.account_id) payload.account_id = args.account_id
      if (args.paid_through_account_id)
        payload.paid_through_account_id = args.paid_through_account_id
      if (args.date) payload.date = args.date
      if (args.amount !== undefined) payload.amount = args.amount
      if (args.description !== undefined) payload.description = args.description
      if (args.reference_number !== undefined) payload.reference_number = args.reference_number
      if (args.customer_id) payload.customer_id = args.customer_id
      if (args.vendor_id) payload.vendor_id = args.vendor_id
      if (args.is_billable !== undefined) payload.is_billable = args.is_billable
      if (args.mileage_type) payload.mileage_type = args.mileage_type
      if (args.distance !== undefined) payload.distance = args.distance
      if (args.mileage_unit) payload.mileage_unit = args.mileage_unit
      if (args.mileage_rate !== undefined) payload.mileage_rate = args.mileage_rate
      if (args.start_reading !== undefined) payload.start_reading = args.start_reading
      if (args.end_reading !== undefined) payload.end_reading = args.end_reading

      if (Object.keys(payload).length === 0) {
        return "**Validation Error**: Provide at least one expense field to update."
      }

      const result = await zohoPut<{ expense: Expense }>(
        `/expenses/${args.expense_id}`,
        args.organization_id,
        payload
      )

      if (!result.ok) {
        return result.errorMessage || "Failed to update expense"
      }

      const expense = result.data?.expense

      if (!expense) {
        return "Expense updated but no details returned"
      }

      const mileageInfo = expense.distance
        ? `\n- **Distance**: ${expense.distance} ${expense.mileage_unit || ""}`
        : ""

      return `**Expense Updated Successfully**

- **Expense ID**: \`${expense.expense_id}\`
- **Date**: ${expense.date}
- **Amount**: ${expense.currency_code || ""} ${expense.amount}${mileageInfo}`
    },
  })

  // Delete Expense
  server.addTool({
    name: "delete_expense",
    description: `Delete an expense record. This action cannot be undone.`,
    parameters: z
      .object({
        organization_id: optionalOrganizationIdSchema.describe(
          "Zoho org ID (uses ZOHO_ORGANIZATION_ID env var if not provided)"
        ),
        expense_id: entityIdSchema.describe("Expense ID to delete"),
      })
      .strict(),
    annotations: {
      title: "Delete Expense",
      readOnlyHint: false,
      openWorldHint: true,
    },
    execute: async (args) => {
      const result = await zohoDelete<Record<string, unknown>>(
        `/expenses/${args.expense_id}`,
        args.organization_id
      )

      if (!result.ok) {
        return result.errorMessage || "Failed to delete expense"
      }

      return `**Expense Deleted Successfully**

Expense \`${args.expense_id}\` has been deleted.`
    },
  })

  // Add Expense Receipt (Attachment)
  server.addTool({
    name: "add_expense_receipt",
    description: `Upload a receipt attachment to an expense.
Supported file types: PDF, PNG, JPG, JPEG, GIF, DOC, DOCX, XLS, XLSX.
Use this to attach scanned receipts or invoice images.
Files must be in allowed directories and under 10MB.`,
    parameters: z.object({
      organization_id: optionalOrganizationIdSchema.describe(
        "Zoho org ID (uses ZOHO_ORGANIZATION_ID env var if not provided)"
      ),
      expense_id: entityIdSchema.describe("Expense ID to attach receipt to"),
      file_path: z.string().max(500).describe("Full local file path to the receipt"),
    }),
    annotations: {
      title: "Add Expense Receipt",
      readOnlyHint: false,
      openWorldHint: true,
    },
    execute: async (args) => {
      const result = await zohoUploadAttachment(
        `/expenses/${args.expense_id}/attachment`,
        args.organization_id,
        args.file_path
      )

      if (!result.ok) {
        return result.errorMessage || "Failed to upload receipt"
      }

      return `**Receipt Added Successfully**

- **Expense ID**: \`${args.expense_id}\`
- **File**: ${args.file_path.split("/").pop()}`
    },
  })

  // Get Expense Receipt
  server.addTool({
    name: "get_expense_receipt",
    description: `Get receipt/attachment information for an expense.
Returns details about any files attached to the expense.`,
    parameters: z.object({
      organization_id: optionalOrganizationIdSchema.describe(
        "Zoho org ID (uses ZOHO_ORGANIZATION_ID env var if not provided)"
      ),
      expense_id: entityIdSchema.describe("Expense ID"),
    }),
    annotations: {
      title: "Get Expense Receipt",
      readOnlyHint: true,
      openWorldHint: true,
    },
    execute: async (args) => {
      const result = await zohoGet<{ documents: Attachment[] }>(
        `/expenses/${args.expense_id}/attachment`,
        args.organization_id
      )

      if (!result.ok) {
        return result.errorMessage || "Failed to get receipt"
      }

      const documents = result.data?.documents || []

      if (documents.length === 0) {
        return `No receipts found for expense \`${args.expense_id}\`.`
      }

      let details = `**Expense Receipts**\n\n- **Expense ID**: \`${args.expense_id}\`\n\n**Documents** (${documents.length}):`
      documents.forEach((doc, i) => {
        details += `\n${i + 1}. ${doc.file_name} (${doc.file_size_formatted || "Unknown"})`
      })

      return details
    },
  })

  // Delete Expense Receipt
  server.addTool({
    name: "delete_expense_receipt",
    description: `Delete receipt/attachment from an expense.
Removes the file association from the expense.`,
    parameters: z.object({
      organization_id: optionalOrganizationIdSchema.describe(
        "Zoho org ID (uses ZOHO_ORGANIZATION_ID env var if not provided)"
      ),
      expense_id: entityIdSchema.describe("Expense ID"),
    }),
    annotations: {
      title: "Delete Expense Receipt",
      readOnlyHint: false,
      openWorldHint: true,
    },
    execute: async (args) => {
      const result = await zohoDeleteAttachment(
        `/expenses/${args.expense_id}/attachment`,
        args.organization_id
      )

      if (!result.ok) {
        return result.errorMessage || "Failed to delete receipt"
      }

      return `**Receipt Deleted Successfully**

Receipt removed from expense \`${args.expense_id}\`.`
    },
  })
}
