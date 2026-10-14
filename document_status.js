// ============================================================================
// INVOICE DOCUMENT STATUS PRESENTATION (Single Source of Truth)
// MS Management Consulting Billing System
// ============================================================================
//
// This module is intentionally dependency-free so the exact same rules are
// used by the Invoice History actions, the View/Print preview sheet, and the
// downloaded PDF — and so the rules can be unit-tested directly in Node.
//
// LIFECYCLE NOTES
// ---------------
// A cancelled invoice must NOT be assumed to have been a tax invoice.
// `invoices.is_draft` is persisted lifecycle information that survives
// cancellation (`cancel_invoice` only flips `status` to 'cancelled' and never
// touches `is_draft`), so the four document types are distinguished as:
//
//   is_draft = TRUE,  status != 'cancelled'  -> DRAFT INVOICE
//   is_draft = TRUE,  status  = 'cancelled'  -> DRAFT INVOICE - CANCELLED
//   is_draft = FALSE, status != 'cancelled'  -> TAX INVOICE (issued/finalized)
//   is_draft = FALSE, status  = 'cancelled'  -> TAX INVOICE - CANCELLED
//
// No historical invoice record is ever rewritten to derive this information.
// ============================================================================

export function isDraftInvoice(inv) {
  return Boolean(inv && inv.is_draft === true);
}

export function isCancelledInvoice(inv) {
  return Boolean(inv && inv.status === 'cancelled');
}

// Official document heading shown in View, PDF, Print and any preview modal.
export function invoiceHeading(inv) {
  const draft = isDraftInvoice(inv);
  const cancelled = isCancelledInvoice(inv);
  if (draft && cancelled) return 'DRAFT INVOICE — CANCELLED';
  if (draft) return 'DRAFT INVOICE';
  if (cancelled) return 'TAX INVOICE — CANCELLED';
  return 'TAX INVOICE';
}

// Visible watermark for draft/cancelled documents. Cancelled always wins so a
// cancelled draft is unmistakably marked CANCELLED (its heading still states
// DRAFT INVOICE — CANCELLED). Returns null for issued documents.
export function invoiceWatermark(inv) {
  if (isCancelledInvoice(inv)) return 'CANCELLED';
  if (isDraftInvoice(inv)) return 'DRAFT';
  return null;
}

// Status-based actions for Invoice History.
//   Draft:                View, Edit, PDF, Cancel, Delete Draft (Cancel & Delete Admin only)
//   Issued (unpaid/partial/paid): View, PDF, Cancel (Admin only)
//   Cancelled issued:     View, PDF, Delete (Admin only)
//   Cancelled draft:      View, PDF, Delete Draft (Admin only)
// Backend enforcement is authoritative (cancel_invoice RPC is admin-only;
// invoice deletion is restricted to drafts/cancelled invoices by policy).
export function invoiceHistoryActions(inv, role) {
  const draft = isDraftInvoice(inv);
  const cancelled = isCancelledInvoice(inv);

  if (draft) {
    if (cancelled) return role === 'admin' ? ['view', 'pdf', 'delete_draft'] : ['view', 'pdf'];
    return role === 'admin' ? ['view', 'edit', 'pdf', 'cancel', 'delete_draft'] : ['view', 'edit', 'pdf'];
  }
  if (cancelled) return role === 'admin' ? ['view', 'pdf', 'delete_draft'] : ['view', 'pdf'];
  return role === 'admin' ? ['view', 'pdf', 'cancel', 'delete_draft'] : ['view', 'pdf'];
}

// ---------------------------------------------------------------------------
// DRAFT SERIAL NUMBERING
// Format: DRAFT-<financial-year>-<4 digits>, e.g. DRAFT-2026-27-0001
// Independent of the permanent GST tax invoice numbering sequence.
// ---------------------------------------------------------------------------

export const DRAFT_NUMBER_PREFIX = 'DRAFT-';

export function formatDraftNumber(financialYear, sequence) {
  return `${DRAFT_NUMBER_PREFIX}${financialYear}-${String(sequence).padStart(4, '0')}`;
}

// Next sequence for a financial year, derived from already-allocated draft
// numbers. Existing draft identifiers (including historical random-style
// DRAFT-xxxxxxxx values) are preserved untouched — they are simply ignored by
// this scan, and no draft is ever renumbered.
export function nextDraftSequence(financialYear, existingNumbers) {
  const prefix = `${DRAFT_NUMBER_PREFIX}${financialYear}-`;
  let max = 0;
  for (const num of existingNumbers || []) {
    if (typeof num !== 'string' || !num.startsWith(prefix)) continue;
    const suffix = num.slice(prefix.length);
    if (!/^\d+$/.test(suffix)) continue;
    const n = parseInt(suffix, 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

export function allocateDraftNumber(financialYear, existingNumbers) {
  return formatDraftNumber(financialYear, nextDraftSequence(financialYear, existingNumbers));
}

// The original draft reference of a finalized invoice, when one was preserved.
export function preservedDraftReference(inv) {
  const ref = inv && inv.draft_reference;
  return typeof ref === 'string' && ref.startsWith(DRAFT_NUMBER_PREFIX) ? ref : null;
}
