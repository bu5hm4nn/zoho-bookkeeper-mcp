/**
 * Validation utilities for input sanitization
 * Security: Provides strict validation for user inputs
 */

import { z } from "zod"

// Date format: YYYY-MM-DD
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/

/**
 * Zod schema for date validation (YYYY-MM-DD format)
 * Security: Prevents invalid date injection
 */
export const dateSchema = z
  .string()
  .regex(DATE_REGEX, "Date must be in YYYY-MM-DD format")
  .refine(
    (date) => {
      const parsed = new Date(date)
      return !isNaN(parsed.getTime())
    },
    { message: "Invalid date value" }
  )

/**
 * Zod schema for optional date validation
 */
export const optionalDateSchema = dateSchema.optional()

/**
 * Zod schema for monetary amounts
 * Security: Prevents overflow and ensures reasonable bounds
 * - Minimum: 0.01 (smallest currency unit)
 * - Maximum: 999,999,999.99 (reasonable business limit)
 * - Precision: 2 decimal places
 */
export const moneySchema = z
  .number()
  .positive("Amount must be positive")
  .max(999_999_999.99, "Amount exceeds maximum allowed value")
  .refine((val) => Number.isFinite(val), { message: "Amount must be a finite number" })
  .refine((val) => Math.round(val * 100) / 100 === val, {
    message: "Amount must have at most 2 decimal places",
  })

/**
 * Zod schema for monetary amounts that can be zero (e.g., discounts)
 */
export const moneyOrZeroSchema = z
  .number()
  .min(0, "Amount cannot be negative")
  .max(999_999_999.99, "Amount exceeds maximum allowed value")
  .refine((val) => Number.isFinite(val), { message: "Amount must be a finite number" })
  .refine((val) => Math.round(val * 100) / 100 === val, {
    message: "Amount must have at most 2 decimal places",
  })

/**
 * Zod schema for organization ID validation
 * Security: Prevents injection via org ID parameter
 */
export const organizationIdSchema = z
  .string()
  .regex(/^[a-zA-Z0-9_-]+$/, "Invalid organization ID format")
  .max(50, "Organization ID too long")

/**
 * Optional organization ID schema
 */
export const optionalOrganizationIdSchema = organizationIdSchema.optional()

/**
 * Zod schema for entity IDs (journal_id, expense_id, etc.)
 * Security: Prevents injection via entity ID parameters
 */
export const entityIdSchema = z
  .string()
  .regex(/^[a-zA-Z0-9_-]+$/, "Invalid ID format")
  .max(50, "ID too long")

/**
 * Validate a date string format
 */
export function isValidDateFormat(date: string): boolean {
  return DATE_REGEX.test(date) && !isNaN(new Date(date).getTime())
}

/**
 * Validate a monetary amount
 */
export function isValidMoney(amount: number): boolean {
  return (
    Number.isFinite(amount) &&
    amount > 0 &&
    amount <= 999_999_999.99 &&
    Math.round(amount * 100) / 100 === amount
  )
}
