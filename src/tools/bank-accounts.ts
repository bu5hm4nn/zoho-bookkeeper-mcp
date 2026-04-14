/**
 * Bank Account tools for Zoho Books API
 */

import { z } from "zod"
import type { FastMCP } from "fastmcp"
import { zohoGet, zohoPost } from "../api/client.js"
import type { BankAccount, BankTransaction, MatchingTransaction } from "../api/types.js"
import {
  dateSchema,
  entityIdSchema,
  moneyOrZeroSchema,
  moneySchema,
  optionalDateSchema,
  optionalOrganizationIdSchema,
} from "../utils/validation.js"

const bankTransactionStatusSchema = z.enum([
  "All",
  "uncategorized",
  "categorized",
  "excluded",
  "matched",
  "manually_added",
])

const matchTransactionSchema = z.object({
  transaction_id: entityIdSchema.describe(
    "Zoho transaction ID to match against the bank transaction"
  ),
  transaction_type: z
    .string()
    .regex(/^[a-zA-Z0-9_-]+$/, "Invalid transaction type format")
    .max(50, "Transaction type too long")
    .describe(
      "Zoho transaction type for the match candidate (for example deposit, transfer_fund, invoice, bill, or creditnote)"
    ),
})

const textFieldSchema = z.string().max(2000)
const optionalShortTextSchema = z.string().max(100).optional()
const optionalTextFieldSchema = textFieldSchema.optional()
const exchangeRateSchema = z
  .number()
  .positive("Exchange rate must be positive")
  .max(1_000_000, "Exchange rate too large")
  .refine((value) => Number.isFinite(value), {
    message: "Exchange rate must be a finite number",
  })

const genericCategorizeTypeSchema = z.enum([
  "deposit",
  "refund",
  "transfer_fund",
  "card_payment",
  "sales_without_invoices",
  "expense_refund",
  "owner_contribution",
  "interest_income",
  "other_income",
  "owner_drawings",
  "sales_return",
])

const vendorPaymentBillSchema = z.object({
  bill_id: entityIdSchema.describe("Bill ID to apply the payment against"),
  amount_applied: moneySchema.describe("Amount to apply to the bill"),
  tax_amount_withheld: moneyOrZeroSchema.optional().describe("Optional withheld tax amount"),
})

const customerPaymentInvoiceSchema = z.object({
  invoice_id: entityIdSchema.describe("Invoice ID to apply the payment against"),
  amount_applied: moneySchema.describe("Amount to apply to the invoice"),
  tax_amount_withheld: moneyOrZeroSchema.optional().describe("Optional withheld tax amount"),
  discount_amount: moneyOrZeroSchema.optional().describe("Optional invoice discount amount"),
})

/**
 * Register bank account tools on the server
 */
export function registerBankAccountTools(server: FastMCP): void {
  // List Bank Accounts
  server.addTool({
    name: "list_bank_accounts",
    description: `List all bank accounts in Zoho Books.
Returns bank account details with name, type, and balance.
These are the accounts linked in Zoho Books, not live bank data.`,
    parameters: z.object({
      organization_id: optionalOrganizationIdSchema.describe(
        "Zoho org ID (uses ZOHO_ORGANIZATION_ID env var if not provided)"
      ),
      filter_by: z
        .enum(["Status.All", "Status.Active", "Status.Inactive"])
        .optional()
        .describe("Filter by status"),
      sort_column: z.enum(["account_name", "account_type"]).optional(),
    }),
    annotations: {
      title: "List Bank Accounts",
      readOnlyHint: true,
      openWorldHint: true,
    },
    execute: async (args) => {
      const queryParams: Record<string, string> = {}
      if (args.filter_by) queryParams.filter_by = args.filter_by
      if (args.sort_column) queryParams.sort_column = args.sort_column

      const result = await zohoGet<{ bankaccounts: BankAccount[] }>(
        "/bankaccounts",
        args.organization_id,
        queryParams
      )

      if (!result.ok) {
        return result.errorMessage || "Failed to list bank accounts"
      }

      const accounts = result.data?.bankaccounts || []

      if (accounts.length === 0) {
        return "No bank accounts found."
      }

      const formatted = accounts
        .map((acc, index) => {
          const balance =
            acc.balance !== undefined ? ` | Balance: ${acc.currency_code || ""} ${acc.balance}` : ""
          // Security: Sanitize account number (remove non-digits) before masking
          const digitsOnly = acc.account_number?.replace(/\D/g, "")
          const maskedAccount =
            digitsOnly && digitsOnly.length >= 4 ? `****${digitsOnly.slice(-4)}` : "N/A"
          return `${index + 1}. **${acc.account_name}** (${acc.account_type})
   - Account ID: \`${acc.account_id}\`
   - Bank: ${acc.bank_name || "N/A"}
   - Account Number: ${maskedAccount}
   - Active: ${acc.is_active ? "Yes" : "No"}${balance}`
        })
        .join("\n\n")

      return `**Bank Accounts** (${accounts.length} accounts)\n\n${formatted}`
    },
  })

  // Get Bank Account
  server.addTool({
    name: "get_bank_account",
    description: `Get detailed information about a specific bank account.
Returns full bank account details including routing number and balance.`,
    parameters: z.object({
      organization_id: optionalOrganizationIdSchema.describe(
        "Zoho org ID (uses ZOHO_ORGANIZATION_ID env var if not provided)"
      ),
      account_id: entityIdSchema.describe("Bank account ID"),
    }),
    annotations: {
      title: "Get Bank Account Details",
      readOnlyHint: true,
      openWorldHint: true,
    },
    execute: async (args) => {
      const result = await zohoGet<{ bankaccount: BankAccount }>(
        `/bankaccounts/${args.account_id}`,
        args.organization_id
      )

      if (!result.ok) {
        return result.errorMessage || "Failed to get bank account"
      }

      const account = result.data?.bankaccount

      if (!account) {
        return "Bank account not found"
      }

      // Security: Sanitize account/routing numbers (remove non-digits) before masking
      const accountDigits = account.account_number?.replace(/\D/g, "")
      const maskedAccount =
        accountDigits && accountDigits.length >= 4 ? `****${accountDigits.slice(-4)}` : "N/A"
      const routingDigits = account.routing_number?.replace(/\D/g, "")
      const maskedRouting =
        routingDigits && routingDigits.length >= 4 ? `****${routingDigits.slice(-4)}` : "N/A"

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
- **Active**: ${account.is_active ? "Yes" : "No"}`
    },
  })

  // List Bank Transactions
  server.addTool({
    name: "list_bank_transactions",
    description: `List bank transactions in Zoho Books.
Returns transactions recorded in Zoho Books for bank reconciliation.
These are transactions imported/entered in Zoho, not live bank feeds.
Bank transaction status is a reconciliation status and is separate from journal creation.`,
    parameters: z.object({
      organization_id: optionalOrganizationIdSchema.describe(
        "Zoho org ID (uses ZOHO_ORGANIZATION_ID env var if not provided)"
      ),
      account_id: entityIdSchema.describe("Bank account ID"),
      date_start: optionalDateSchema.describe("Start date (YYYY-MM-DD)"),
      date_end: optionalDateSchema.describe("End date (YYYY-MM-DD)"),
      status: bankTransactionStatusSchema.optional(),
      sort_column: z.enum(["date", "amount"]).optional(),
      page: z.number().int().positive().optional(),
      per_page: z.number().int().min(1).max(200).optional(),
    }),
    annotations: {
      title: "List Bank Transactions",
      readOnlyHint: true,
      openWorldHint: true,
    },
    execute: async (args) => {
      const queryParams: Record<string, string> = {
        account_id: args.account_id,
      }
      if (args.date_start) queryParams.date_start = args.date_start
      if (args.date_end) queryParams.date_end = args.date_end
      if (args.status) queryParams.status = args.status
      if (args.sort_column) queryParams.sort_column = args.sort_column
      if (args.page) queryParams.page = args.page.toString()
      if (args.per_page) queryParams.per_page = args.per_page.toString()

      const result = await zohoGet<{ banktransactions: BankTransaction[] }>(
        "/banktransactions",
        args.organization_id,
        queryParams
      )

      if (!result.ok) {
        return result.errorMessage || "Failed to list bank transactions"
      }

      const transactions = result.data?.banktransactions || []

      if (transactions.length === 0) {
        return "No bank transactions found."
      }

      const formatted = transactions
        .map((tx, index) => {
          const amount = tx.debit_or_credit === "debit" ? `-${tx.amount}` : `+${tx.amount}`
          return `${index + 1}. **${tx.date}** - ${tx.currency_code || ""} ${amount}
   - Transaction ID: \`${tx.transaction_id}\`
   - Type: ${tx.transaction_type}
   - Status: ${tx.status}
   - Source: ${tx.source || "N/A"}
   - Payee: ${tx.payee || "N/A"}
   - Reference: ${tx.reference_number || "N/A"}
   - Description: ${tx.description || "N/A"}`
        })
        .join("\n\n")

      return `**Bank Transactions** (${transactions.length} transactions)\n\n${formatted}`
    },
  })

  // Get candidate matches for an uncategorized bank transaction
  server.addTool({
    name: "get_bank_transaction_matches",
    description: `Get candidate Zoho transactions that can be matched to an uncategorized bank transaction.
Use this before match_bank_transaction to inspect possible matches.
Zoho may return direct bank transactions and also invoices, bills, or credit notes that can be reconciled via derived payment/refund entries.`,
    parameters: z.object({
      organization_id: optionalOrganizationIdSchema.describe(
        "Zoho org ID (uses ZOHO_ORGANIZATION_ID env var if not provided)"
      ),
      account_id: entityIdSchema.describe("Bank account ID"),
      transaction_id: entityIdSchema.describe("Uncategorized bank transaction ID"),
      transaction_type: z
        .string()
        .regex(/^[a-zA-Z0-9_-]+$/, "Invalid transaction type format")
        .max(50, "Transaction type too long")
        .optional()
        .describe("Optional transaction type filter for candidate matches"),
      date_start: optionalDateSchema.describe("Filter matches on or after this date (YYYY-MM-DD)"),
      date_end: optionalDateSchema.describe("Filter matches on or before this date (YYYY-MM-DD)"),
      amount_start: moneySchema.optional().describe("Minimum match amount"),
      amount_end: moneySchema.optional().describe("Maximum match amount"),
      reference_number: z.string().max(100).optional().describe("Reference number filter"),
      show_all_transactions: z
        .boolean()
        .optional()
        .describe("If true, return all candidates instead of only Zoho's best suggestions"),
      page: z.number().int().positive().optional(),
      per_page: z.number().int().min(1).max(200).optional(),
    }),
    annotations: {
      title: "Get Bank Transaction Matches",
      readOnlyHint: true,
      openWorldHint: true,
    },
    execute: async (args) => {
      const queryParams: Record<string, string> = {
        account_id: args.account_id,
      }
      if (args.transaction_type) queryParams.transaction_type = args.transaction_type
      if (args.date_start) queryParams.date_start = args.date_start
      if (args.date_end) queryParams.date_end = args.date_end
      if (args.amount_start !== undefined) queryParams.amount_start = args.amount_start.toString()
      if (args.amount_end !== undefined) queryParams.amount_end = args.amount_end.toString()
      if (args.reference_number) queryParams.reference_number = args.reference_number
      if (args.show_all_transactions !== undefined) {
        queryParams.show_all_transactions = String(args.show_all_transactions)
      }
      if (args.page) queryParams.page = args.page.toString()
      if (args.per_page) queryParams.per_page = args.per_page.toString()

      const result = await zohoGet<{ matching_transactions: MatchingTransaction[] }>(
        `/banktransactions/uncategorized/${args.transaction_id}/match`,
        args.organization_id,
        queryParams
      )

      if (!result.ok) {
        return result.errorMessage || "Failed to get bank transaction matches"
      }

      const matches = result.data?.matching_transactions || []

      if (matches.length === 0) {
        return `No candidate matches found for bank transaction \`${args.transaction_id}\`.`
      }

      const formatted = matches
        .map((match, index) => {
          const amount = match.debit_or_credit === "debit" ? `-${match.amount}` : `+${match.amount}`
          const bestMatch = match.is_best_match ? " | Best match" : ""
          return `${index + 1}. **${match.date}** - ${amount}${bestMatch}
   - Transaction ID: \`${match.transaction_id}\`
   - Type: ${match.transaction_type}
   - Transaction Number: ${match.transaction_number || "N/A"}
   - Contact: ${match.contact_name || "N/A"}
   - Reference: ${match.reference_number || "N/A"}`
        })
        .join("\n\n")

      return `**Candidate Matches** (${matches.length} found)\n\n${formatted}`
    },
  })

  // Match an uncategorized bank transaction to existing Zoho transactions
  server.addTool({
    name: "match_bank_transaction",
    description: `Match an uncategorized bank transaction to one or more existing Zoho transactions.
Use get_bank_transaction_matches first to inspect candidates.
This updates bank reconciliation status; creating a journal alone does not mark imported bank transactions as matched.`,
    parameters: z.object({
      organization_id: optionalOrganizationIdSchema.describe(
        "Zoho org ID (uses ZOHO_ORGANIZATION_ID env var if not provided)"
      ),
      account_id: entityIdSchema.describe("Bank account ID"),
      transaction_id: entityIdSchema.describe("Uncategorized bank transaction ID to reconcile"),
      transactions_to_be_matched: z
        .array(matchTransactionSchema)
        .min(1, "At least one transaction must be provided")
        .max(25, "Too many transactions to match in one request")
        .describe("Existing Zoho transactions to match against this bank transaction"),
    }),
    annotations: {
      title: "Match Bank Transaction",
      readOnlyHint: false,
      openWorldHint: true,
    },
    execute: async (args) => {
      const result = await zohoPost<{ message?: string }>(
        `/banktransactions/uncategorized/${args.transaction_id}/match`,
        args.organization_id,
        {
          transactions_to_be_matched: args.transactions_to_be_matched,
        },
        {
          account_id: args.account_id,
        }
      )

      if (!result.ok) {
        return result.errorMessage || "Failed to match bank transaction"
      }

      return `**Success**: Bank transaction matched
- **Bank Transaction ID**: \`${args.transaction_id}\`
- **Matched Transactions**: ${args.transactions_to_be_matched.length}
- **Account ID**: \`${args.account_id}\``
    },
  })

  // Unmatch a matched bank transaction
  server.addTool({
    name: "unmatch_bank_transaction",
    description: `Unmatch a previously matched bank transaction and return it to uncategorized status.
Use this when the wrong Zoho transaction was reconciled to a statement line.`,
    parameters: z.object({
      organization_id: optionalOrganizationIdSchema.describe(
        "Zoho org ID (uses ZOHO_ORGANIZATION_ID env var if not provided)"
      ),
      account_id: entityIdSchema.describe("Bank account ID"),
      transaction_id: entityIdSchema.describe("Matched bank transaction ID to unmatch"),
    }),
    annotations: {
      title: "Unmatch Bank Transaction",
      readOnlyHint: false,
      openWorldHint: true,
    },
    execute: async (args) => {
      const result = await zohoPost<{ message?: string }>(
        `/banktransactions/${args.transaction_id}/unmatch`,
        args.organization_id,
        undefined,
        {
          account_id: args.account_id,
        }
      )

      if (!result.ok) {
        return result.errorMessage || "Failed to unmatch bank transaction"
      }

      return `**Success**: Bank transaction unmatched
- **Bank Transaction ID**: \`${args.transaction_id}\`
- **Account ID**: \`${args.account_id}\`
- **New Status**: uncategorized`
    },
  })

  // Categorize an uncategorized bank transaction as a generic bank transaction
  server.addTool({
    name: "categorize_bank_transaction_generic",
    description: `Categorize an uncategorized bank transaction into a general Zoho bank transaction.
Use this for deposits, transfers, owner contributions/drawings, interest income, other income, sales without invoices, expense refunds, sales returns, and similar bank-native bookkeeping flows.
Prefer matching or expense/vendor/customer payment categorization when those are a better fit than a generic bank transaction.`,
    parameters: z.object({
      organization_id: optionalOrganizationIdSchema.describe(
        "Zoho org ID (uses ZOHO_ORGANIZATION_ID env var if not provided)"
      ),
      transaction_id: entityIdSchema.describe("Uncategorized bank transaction ID"),
      transaction_type: genericCategorizeTypeSchema.describe(
        "Generic bank transaction type to create"
      ),
      from_account_id: entityIdSchema.describe("Source account ID for the transaction"),
      to_account_id: entityIdSchema.describe("Destination account ID for the transaction"),
      amount: moneySchema.describe("Transaction amount"),
      date: dateSchema.describe("Transaction date (YYYY-MM-DD)"),
      payment_mode: optionalShortTextSchema.describe(
        "Optional payment mode such as Cash or Cheque"
      ),
      exchange_rate: exchangeRateSchema.optional().describe("Optional exchange rate"),
      reference_number: optionalShortTextSchema.describe("Optional reference number"),
      description: optionalTextFieldSchema.describe("Optional description or memo"),
      customer_id: entityIdSchema.optional().describe("Optional customer ID"),
      currency_id: entityIdSchema.optional().describe("Optional currency ID"),
    }),
    annotations: {
      title: "Categorize Bank Transaction (Generic)",
      readOnlyHint: false,
      openWorldHint: true,
    },
    execute: async (args) => {
      const payload: Record<string, unknown> = {
        transaction_type: args.transaction_type,
        from_account_id: args.from_account_id,
        to_account_id: args.to_account_id,
        amount: args.amount,
        date: args.date,
      }
      if (args.payment_mode) payload.payment_mode = args.payment_mode
      if (args.exchange_rate !== undefined) payload.exchange_rate = args.exchange_rate
      if (args.reference_number) payload.reference_number = args.reference_number
      if (args.description) payload.description = args.description
      if (args.customer_id) payload.customer_id = args.customer_id
      if (args.currency_id) payload.currency_id = args.currency_id

      const result = await zohoPost<{ message?: string }>(
        `/banktransactions/uncategorized/${args.transaction_id}/categorize`,
        args.organization_id,
        payload
      )

      if (!result.ok) {
        return result.errorMessage || "Failed to categorize bank transaction"
      }

      return `**Success**: Bank transaction categorized
- **Bank Transaction ID**: \`${args.transaction_id}\`
- **Categorized As**: ${args.transaction_type}
- **Amount**: ${args.amount}
- **Date**: ${args.date}`
    },
  })

  // Categorize an uncategorized bank transaction as an expense
  server.addTool({
    name: "categorize_bank_transaction_as_expense",
    description: `Categorize an uncategorized bank transaction as an expense.
Use this for routine spending that should become an expense record instead of a manual journal entry.`,
    parameters: z.object({
      organization_id: optionalOrganizationIdSchema.describe(
        "Zoho org ID (uses ZOHO_ORGANIZATION_ID env var if not provided)"
      ),
      transaction_id: entityIdSchema.describe("Uncategorized bank transaction ID"),
      account_id: entityIdSchema.describe("Expense account ID"),
      paid_through_account_id: entityIdSchema.describe(
        "Bank or credit account the payment was made through"
      ),
      date: dateSchema.describe("Expense date (YYYY-MM-DD)"),
      amount: moneySchema.describe("Expense amount"),
      description: optionalTextFieldSchema.describe("Optional expense description"),
      reference_number: optionalShortTextSchema.describe("Optional reference number"),
      customer_id: entityIdSchema.optional().describe("Optional customer ID"),
      vendor_id: entityIdSchema.optional().describe("Optional vendor ID"),
      is_billable: z.boolean().optional().describe("Whether the expense is billable"),
      exchange_rate: exchangeRateSchema.optional().describe("Optional exchange rate"),
    }),
    annotations: {
      title: "Categorize Bank Transaction as Expense",
      readOnlyHint: false,
      openWorldHint: true,
    },
    execute: async (args) => {
      const payload: Record<string, unknown> = {
        account_id: args.account_id,
        paid_through_account_id: args.paid_through_account_id,
        date: args.date,
        amount: args.amount,
      }
      if (args.description) payload.description = args.description
      if (args.reference_number) payload.reference_number = args.reference_number
      if (args.customer_id) payload.customer_id = args.customer_id
      if (args.vendor_id) payload.vendor_id = args.vendor_id
      if (args.is_billable !== undefined) payload.is_billable = args.is_billable
      if (args.exchange_rate !== undefined) payload.exchange_rate = args.exchange_rate

      const result = await zohoPost<{ message?: string }>(
        `/banktransactions/uncategorized/${args.transaction_id}/categorize/expenses`,
        args.organization_id,
        payload
      )

      if (!result.ok) {
        return result.errorMessage || "Failed to categorize bank transaction as expense"
      }

      return `**Success**: Bank transaction categorized as expense
- **Bank Transaction ID**: \`${args.transaction_id}\`
- **Expense Account ID**: \`${args.account_id}\`
- **Paid Through Account ID**: \`${args.paid_through_account_id}\`
- **Amount**: ${args.amount}`
    },
  })

  // Categorize an uncategorized bank transaction as a vendor payment
  server.addTool({
    name: "categorize_bank_transaction_as_vendor_payment",
    description: `Categorize an uncategorized bank transaction as a vendor payment.
Use this when the bank line represents payment of one or more vendor bills.
Prefer matching when the bank line should be linked to an existing Zoho transaction, and use manual journals only for exception cases that cannot be matched or categorized cleanly.`,
    parameters: z.object({
      organization_id: optionalOrganizationIdSchema.describe(
        "Zoho org ID (uses ZOHO_ORGANIZATION_ID env var if not provided)"
      ),
      transaction_id: entityIdSchema.describe("Uncategorized bank transaction ID"),
      vendor_id: entityIdSchema.describe("Vendor ID"),
      bills: z
        .array(vendorPaymentBillSchema)
        .min(1)
        .max(50)
        .describe("Bills to apply the payment against"),
      amount: moneySchema.describe("Total vendor payment amount"),
      date: dateSchema.describe("Payment date (YYYY-MM-DD)"),
      paid_through_account_id: entityIdSchema.describe(
        "Bank or credit account the payment was made through"
      ),
      payment_mode: optionalShortTextSchema.describe(
        "Optional payment mode such as Cash or Cheque"
      ),
      description: optionalTextFieldSchema.describe("Optional payment description"),
      reference_number: optionalShortTextSchema.describe("Optional reference number"),
      exchange_rate: exchangeRateSchema.optional().describe("Optional exchange rate"),
      is_paid_via_print_check: z
        .boolean()
        .optional()
        .describe("Whether the payment was made via printed check"),
    }),
    annotations: {
      title: "Categorize Bank Transaction as Vendor Payment",
      readOnlyHint: false,
      openWorldHint: true,
    },
    execute: async (args) => {
      const payload: Record<string, unknown> = {
        vendor_id: args.vendor_id,
        bills: args.bills,
        amount: args.amount,
        date: args.date,
        paid_through_account_id: args.paid_through_account_id,
      }
      if (args.payment_mode) payload.payment_mode = args.payment_mode
      if (args.description) payload.description = args.description
      if (args.reference_number) payload.reference_number = args.reference_number
      if (args.exchange_rate !== undefined) payload.exchange_rate = args.exchange_rate
      if (args.is_paid_via_print_check !== undefined) {
        payload.is_paid_via_print_check = args.is_paid_via_print_check
      }

      const result = await zohoPost<{ message?: string }>(
        `/banktransactions/uncategorized/${args.transaction_id}/categorize/vendorpayments`,
        args.organization_id,
        payload
      )

      if (!result.ok) {
        return result.errorMessage || "Failed to categorize bank transaction as vendor payment"
      }

      return `**Success**: Bank transaction categorized as vendor payment
- **Bank Transaction ID**: \`${args.transaction_id}\`
- **Vendor ID**: \`${args.vendor_id}\`
- **Bills Applied**: ${args.bills.length}
- **Amount**: ${args.amount}`
    },
  })

  // Categorize an uncategorized bank transaction as a customer payment
  server.addTool({
    name: "categorize_bank_transaction_as_customer_payment",
    description: `Categorize an uncategorized bank transaction as a customer payment.
Use this when the bank line represents receipt of payment for one or more invoices.
Prefer matching when the bank line should be linked to an existing Zoho transaction, and use manual journals only for exception cases that cannot be matched or categorized cleanly.`,
    parameters: z.object({
      organization_id: optionalOrganizationIdSchema.describe(
        "Zoho org ID (uses ZOHO_ORGANIZATION_ID env var if not provided)"
      ),
      transaction_id: entityIdSchema.describe("Uncategorized bank transaction ID"),
      customer_id: entityIdSchema.describe("Customer ID"),
      invoices: z
        .array(customerPaymentInvoiceSchema)
        .min(1)
        .max(50)
        .describe("Invoices to apply the payment against"),
      amount: moneySchema.describe("Total customer payment amount"),
      date: dateSchema.describe("Payment date (YYYY-MM-DD)"),
      account_id: entityIdSchema.describe("Bank account ID receiving the payment"),
      payment_mode: optionalShortTextSchema.describe(
        "Optional payment mode such as Cash or Cheque"
      ),
      description: optionalTextFieldSchema.describe("Optional payment description"),
      reference_number: optionalShortTextSchema.describe("Optional reference number"),
      exchange_rate: exchangeRateSchema.optional().describe("Optional exchange rate"),
      bank_charges: moneyOrZeroSchema.optional().describe("Optional bank charges"),
    }),
    annotations: {
      title: "Categorize Bank Transaction as Customer Payment",
      readOnlyHint: false,
      openWorldHint: true,
    },
    execute: async (args) => {
      const payload: Record<string, unknown> = {
        customer_id: args.customer_id,
        invoices: args.invoices,
        amount: args.amount,
        date: args.date,
        account_id: args.account_id,
      }
      if (args.payment_mode) payload.payment_mode = args.payment_mode
      if (args.description) payload.description = args.description
      if (args.reference_number) payload.reference_number = args.reference_number
      if (args.exchange_rate !== undefined) payload.exchange_rate = args.exchange_rate
      if (args.bank_charges !== undefined) payload.bank_charges = args.bank_charges

      const result = await zohoPost<{ message?: string }>(
        `/banktransactions/uncategorized/${args.transaction_id}/categorize/customerpayments`,
        args.organization_id,
        payload
      )

      if (!result.ok) {
        return result.errorMessage || "Failed to categorize bank transaction as customer payment"
      }

      return `**Success**: Bank transaction categorized as customer payment
- **Bank Transaction ID**: \`${args.transaction_id}\`
- **Customer ID**: \`${args.customer_id}\`
- **Invoices Applied**: ${args.invoices.length}
- **Amount**: ${args.amount}`
    },
  })

  // Revert a categorized bank transaction back to uncategorized
  server.addTool({
    name: "uncategorize_bank_transaction",
    description: `Uncategorize a previously categorized bank transaction and return it to uncategorized status.
Use this to reverse an incorrect categorization and reprocess the bank line correctly.
After uncategorizing, decide whether the bank line should be matched to an existing Zoho transaction, recategorized, or handled with a manual journal only in exception cases.`,
    parameters: z.object({
      organization_id: optionalOrganizationIdSchema.describe(
        "Zoho org ID (uses ZOHO_ORGANIZATION_ID env var if not provided)"
      ),
      account_id: entityIdSchema.describe("Bank account ID"),
      transaction_id: entityIdSchema.describe("Categorized bank transaction ID to uncategorize"),
    }),
    annotations: {
      title: "Uncategorize Bank Transaction",
      readOnlyHint: false,
      openWorldHint: true,
    },
    execute: async (args) => {
      const result = await zohoPost<{ message?: string }>(
        `/banktransactions/${args.transaction_id}/uncategorize`,
        args.organization_id,
        undefined,
        {
          account_id: args.account_id,
        }
      )

      if (!result.ok) {
        return result.errorMessage || "Failed to uncategorize bank transaction"
      }

      return `**Success**: Bank transaction uncategorized
- **Bank Transaction ID**: \`${args.transaction_id}\`
- **Account ID**: \`${args.account_id}\`
- **New Status**: uncategorized`
    },
  })
}
