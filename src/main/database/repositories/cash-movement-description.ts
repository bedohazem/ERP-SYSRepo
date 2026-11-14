import type Database from 'better-sqlite3';

type CashReference = {
  reference_type?: string | null;
  reference_id?: number | null;
  notes?: string | null;
};

type PartyLookup = {
  label: string;
  mentioned: RegExp;
  sql: string;
};

const supplierBatch: PartyLookup = {
  label: 'المورد',
  mentioned: /مورد|شراء/,
  sql: `
    SELECT s.name
    FROM supplier_payment_batches b
    JOIN suppliers s ON s.id = b.supplier_id
    WHERE b.id = ?
  `,
};

const supplierInvoice: PartyLookup = {
  label: 'المورد',
  mentioned: /مورد|شراء/,
  sql: `
    SELECT s.name
    FROM purchase_invoices pi
    JOIN suppliers s ON s.id = pi.supplier_id
    WHERE pi.id = ?
  `,
};

const supplierReturn: PartyLookup = {
  label: 'المورد',
  mentioned: /مورد|شراء/,
  sql: `
    SELECT s.name
    FROM purchase_returns pr
    JOIN suppliers s ON s.id = pr.supplier_id
    WHERE pr.id = ?
  `,
};

const supplierAdvance: PartyLookup = {
  label: 'المورد',
  mentioned: /مورد|شراء/,
  sql: `
    SELECT s.name
    FROM supplier_account_credits c
    JOIN suppliers s ON s.id = c.supplier_id
    WHERE c.id = ?
  `,
};

const customerBatch: PartyLookup = {
  label: 'العميل',
  mentioned: /عميل|بيع/,
  sql: `
    SELECT c.name
    FROM customer_payment_batches b
    JOIN customers c ON c.id = b.customer_id
    WHERE b.id = ?
  `,
};

const customerSale: PartyLookup = {
  label: 'العميل',
  mentioned: /عميل|بيع|استبدال/,
  sql: `
    SELECT c.name
    FROM sales s
    JOIN customers c ON c.id = s.customer_id
    WHERE s.id = ?
  `,
};

const customerReturn: PartyLookup = {
  label: 'العميل',
  mentioned: /عميل|بيع|استبدال/,
  sql: `
    SELECT c.name
    FROM sale_returns sr
    JOIN sales s ON s.id = sr.original_sale_id
    JOIN customers c
      ON c.id = COALESCE(sr.customer_id, s.customer_id)
    WHERE sr.id = ?
  `,
};

const customerExchange: PartyLookup = {
  label: 'العميل',
  mentioned: /عميل|بيع|استبدال/,
  sql: `
    SELECT c.name
    FROM sale_exchanges se
    JOIN sales s ON s.id = se.original_sale_id
    JOIN customers c ON c.id = s.customer_id
    WHERE se.id = ?
  `,
};

const expense: PartyLookup = {
  label: 'المصروف',
  mentioned: /مصروف/,
  sql: `
    SELECT title AS name
    FROM expenses
    WHERE id = ?
  `,
};

const liability: PartyLookup = {
  label: 'الجهة',
  mentioned: /التزام|جهة/,
  sql: `
    SELECT
      COALESCE(
        NULLIF(TRIM(l.party_name), ''),
        l.title
      ) AS name
    FROM store_liability_payments p
    JOIN store_liabilities l ON l.id = p.liability_id
    WHERE p.id = ?
  `,
};

const lookups: Record<string, PartyLookup> = {
  supplier_payment: supplierBatch,
  supplier_payment_cancel: supplierBatch,
  supplier_payment_update_reverse: supplierBatch,

  purchase_invoice: supplierInvoice,
  purchase_edit_reversal: supplierInvoice,
  purchase_cancel: supplierInvoice,

  purchase_return: supplierReturn,
  purchase_return_cancel: supplierReturn,

  supplier_advance: supplierAdvance,
  supplier_advance_cancel: supplierAdvance,

  customer_payment: customerBatch,
  customer_payment_cancel: customerBatch,
  customer_payment_update_reverse: customerBatch,

  sale: customerSale,
  sale_edit_reversal: customerSale,
  sale_cancel: customerSale,

  sale_return: customerReturn,
  sale_return_cancel: customerReturn,

  sale_exchange: customerExchange,
  sale_exchange_cancel: customerExchange,

  expense,
  expense_cancel: expense,
  expense_update_reverse: expense,

  store_liability_payment: liability,
  store_liability_payment_cancel: liability,
  store_liability_payment_update_reverse: liability,
};

export function getCashMovementDisplayNotes(
  db: Database.Database,
  movement: CashReference,
): string {
  const originalNotes = String(movement.notes ?? '').trim();

  const referenceId = Number(movement.reference_id);

  if (!Number.isSafeInteger(referenceId) || referenceId <= 0) {
    return originalNotes;
  }

  const referenceType = String(movement.reference_type ?? '');
  const lookup = lookups[referenceType];

  if (!lookup) {
    return originalNotes;
  }

  const row = db.prepare(lookup.sql).get(referenceId) as
    { name: string | null } | undefined;

  const name = String(row?.name ?? '').trim();

  if (!name) {
    return originalNotes;
  }

  // الوصف لو فيه الاسم بالفعل، مش هنكرره.
  // وده يشمل الدفعات المقدمة المسجلة باسم المورد.
  if (
    originalNotes.includes(name) ||
    originalNotes.includes(`${lookup.label}:`)
  ) {
    return originalNotes;
  }

  const partyText = lookup.mentioned.test(originalNotes)
    ? name
    : `${lookup.label}: ${name}`;

  return originalNotes
    ? `${originalNotes} — ${partyText}`
    : `${lookup.label}: ${name}`;
}
