import { getDb } from '../db';

type TraceAllocation = {
  id: number;
  purchase_id: number;
  amount: number;
  created_at: string;
  cancelled_at: string | null;
};

type TraceMovement = {
  id: number;
  direction: string;
  amount: number;
  payment_method: string | null;
  reference_type: string;
  created_at: string;
  actor_name: string | null;
};

type TraceEvent = {
  id: number;
  title: string;
  created_at: string;
  actor_name: string | null;
  old_amount: number | null;
  new_amount: number | null;
  reason: string | null;
};

export type SupplierFinancialTrace = {
  key: string;
  title: string;
  amount: number;
  cash_amount: number | null;
  payment_method: string | null;
  created_at: string;
  created_by_name: string | null;
  cancelled_at: string | null;
  cancelled_by_name: string | null;
  cancel_reason: string | null;
  replacement_batch_id: number | null;
  allocations: TraceAllocation[];
  cash_movements: TraceMovement[];
  events: TraceEvent[];
};

function numericOrNull(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getSupplierFinancialTraces(
  supplierId: number,
): SupplierFinancialTrace[] {
  const db = getDb();

  const credits = db
    .prepare(
      `
      SELECT
        c.id, c.source_type, c.amount, c.payment_method,
        c.created_at, c.cancelled_at, c.cancel_reason,
        COALESCE(creator.name, creator.username) AS created_by_name,
        COALESCE(canceller.name, canceller.username) AS cancelled_by_name
      FROM supplier_account_credits c
      LEFT JOIN users creator ON creator.id = c.created_by
      LEFT JOIN users canceller ON canceller.id = c.cancelled_by
      WHERE c.supplier_id = ?
      ORDER BY c.id DESC
      `,
    )
    .all(supplierId) as Array<{
    id: number;
    source_type: string;
    amount: number;
    payment_method: string | null;
    created_at: string;
    cancelled_at: string | null;
    cancel_reason: string | null;
    created_by_name: string | null;
    cancelled_by_name: string | null;
  }>;

  const batches = db
    .prepare(
      `
      SELECT
        b.id, b.amount, b.cash_amount, b.payment_method,
        b.created_at, b.cancelled_at, b.cancel_reason,
        b.replacement_batch_id,
        COALESCE(creator.name, creator.username) AS created_by_name,
        COALESCE(canceller.name, canceller.username) AS cancelled_by_name
      FROM supplier_payment_batches b
      LEFT JOIN users creator ON creator.id = b.created_by
      LEFT JOIN users canceller ON canceller.id = b.cancelled_by
      WHERE b.supplier_id = ?
      ORDER BY b.id DESC
      `,
    )
    .all(supplierId) as Array<{
    id: number;
    amount: number;
    cash_amount: number | null;
    payment_method: string | null;
    created_at: string;
    cancelled_at: string | null;
    cancel_reason: string | null;
    replacement_batch_id: number | null;
    created_by_name: string | null;
    cancelled_by_name: string | null;
  }>;

  const creditAllocations = db
    .prepare(
      `
      SELECT a.id, a.credit_id AS source_id,
             a.purchase_id, a.amount, a.created_at, a.cancelled_at
      FROM supplier_account_credit_allocations a
      JOIN supplier_account_credits c ON c.id = a.credit_id
      WHERE c.supplier_id = ?
      ORDER BY a.id ASC
      `,
    )
    .all(supplierId) as Array<TraceAllocation & { source_id: number }>;

  const batchAllocations = db
    .prepare(
      `
      SELECT p.id, p.batch_id AS source_id,
             p.purchase_id, p.amount, p.created_at,
             b.cancelled_at
      FROM supplier_payments p
      JOIN supplier_payment_batches b ON b.id = p.batch_id
      WHERE b.supplier_id = ?
      ORDER BY p.id ASC
      `,
    )
    .all(supplierId) as Array<TraceAllocation & { source_id: number }>;

  const movements = db
    .prepare(
      `
      SELECT
        m.id, m.reference_id, m.reference_type,
        m.direction, m.amount, m.payment_method, m.created_at,
        COALESCE(u.name, u.username) AS actor_name,
        CASE
          WHEN m.reference_type IN (
            'supplier_advance', 'supplier_advance_adjustment',
            'supplier_advance_cancel'
          ) THEN 'credit'
          ELSE 'payment'
        END AS source_kind
      FROM cash_movements m
      LEFT JOIN users u ON u.id = m.created_by
      WHERE m.cancelled_at IS NULL
        AND (
          (
            m.reference_type IN (
              'supplier_advance', 'supplier_advance_adjustment',
              'supplier_advance_cancel'
            )
            AND EXISTS (
              SELECT 1 FROM supplier_account_credits c
              WHERE c.id = m.reference_id
                AND c.supplier_id = ?
                AND c.source_type = 'advance_payment'
            )
          )
          OR (
            m.reference_type IN (
              'supplier_payment', 'supplier_payment_cancel',
              'supplier_payment_update_reverse'
            )
            AND EXISTS (
              SELECT 1 FROM supplier_payment_batches b
              WHERE b.id = m.reference_id AND b.supplier_id = ?
            )
          )
        )
      ORDER BY m.id ASC
      `,
    )
    .all(supplierId, supplierId) as Array<
    TraceMovement & { reference_id: number; source_kind: string }
  >;

  const auditRows = db
    .prepare(
      `
      SELECT
        al.id, al.action, al.entity, al.entity_id,
        al.details, al.created_at,
        COALESCE(u.name, u.username) AS actor_name
      FROM activity_logs al
      LEFT JOIN users u ON u.id = al.user_id
      WHERE
        (al.entity = 'supplier_account_credits' AND EXISTS (
          SELECT 1 FROM supplier_account_credits c
          WHERE c.id = al.entity_id AND c.supplier_id = ?
        ))
        OR (al.entity = 'supplier_payment_batches' AND EXISTS (
          SELECT 1 FROM supplier_payment_batches b
          WHERE b.id = al.entity_id AND b.supplier_id = ?
        ))
      ORDER BY al.id ASC
      `,
    )
    .all(supplierId, supplierId) as Array<{
    id: number;
    action: string;
    entity: string;
    entity_id: number;
    details: string | null;
    created_at: string;
    actor_name: string | null;
  }>;

  const actionNames: Record<string, string> = {
    supplier_advance_created: 'تسجيل دفعة مقدمة',
    supplier_advance_updated: 'تصحيح دفعة مقدمة',
    supplier_advance_cancelled: 'إلغاء دفعة مقدمة',
    supplier_opening_balance_created: 'تسجيل رصيد افتتاحي',
    supplier_opening_balance_updated: 'تعديل رصيد افتتاحي',
    supplier_opening_balance_cancelled: 'إلغاء رصيد افتتاحي',
    supplier_payment_recorded: 'تسجيل دفعة مورد',
    supplier_payment_updated: 'تعديل دفعة مورد',
    supplier_payment_cancelled: 'إلغاء دفعة مورد',
  };

  const auditEvents = auditRows.map((row) => {
    let details: Record<string, unknown> = {};
    try {
      const value: unknown = JSON.parse(row.details || '{}');
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        details = value as Record<string, unknown>;
      }
    } catch {
      // Legacy activity logs may contain plain text.
    }

    return {
      source_kind:
        row.entity === 'supplier_account_credits' ? 'credit' : 'payment',
      source_id: row.entity_id,
      id: row.id,
      title: actionNames[row.action] || row.action,
      created_at: row.created_at,
      actor_name: row.actor_name,
      old_amount: numericOrNull(details.old_amount),
      new_amount: numericOrNull(details.new_amount ?? details.amount),
      reason:
        typeof details.reason === 'string' && details.reason.trim()
          ? details.reason
          : null,
    };
  });

  const allocationsFor = (kind: string, sourceId: number) =>
    (kind === 'credit' ? creditAllocations : batchAllocations)
      .filter((row) => Number(row.source_id) === sourceId)
      .map(({ id, purchase_id, amount, created_at, cancelled_at }) => ({
        id,
        purchase_id,
        amount,
        created_at,
        cancelled_at,
      }));

  const movementsFor = (kind: string, sourceId: number) =>
    movements
      .filter(
        (row) =>
          row.source_kind === kind && Number(row.reference_id) === sourceId,
      )
      .map(
        ({
          id,
          direction,
          amount,
          payment_method,
          reference_type,
          created_at,
          actor_name,
        }) => ({
          id,
          direction,
          amount,
          payment_method,
          reference_type,
          created_at,
          actor_name,
        }),
      );

  const eventsFor = (kind: string, sourceId: number): TraceEvent[] =>
    auditEvents
      .filter(
        (event) =>
          event.source_kind === kind && Number(event.source_id) === sourceId,
      )
      .map(
        ({
          id,
          title,
          created_at,
          actor_name,
          old_amount,
          new_amount,
          reason,
        }) => ({
          id,
          title,
          created_at,
          actor_name,
          old_amount,
          new_amount,
          reason,
        }),
      );

  const creditNames: Record<string, string> = {
    opening_credit: 'رصيد افتتاحي دائن',
    advance_payment: 'دفعة مقدمة',
    purchase_overpayment: 'زيادة دفع فاتورة',
    payment_overpayment: 'زيادة دفعة مورد',
  };

  return [
    ...credits.map((row) => ({
      key: `credit-${row.id}`,
      title: `${creditNames[row.source_type] || 'رصيد دائن'} #${row.id}`,
      amount: row.amount,
      cash_amount: null,
      payment_method: row.payment_method,
      created_at: row.created_at,
      created_by_name: row.created_by_name,
      cancelled_at: row.cancelled_at,
      cancelled_by_name: row.cancelled_by_name,
      cancel_reason: row.cancel_reason,
      replacement_batch_id: null,
      allocations: allocationsFor('credit', row.id),
      cash_movements: movementsFor('credit', row.id),
      events: eventsFor('credit', row.id),
    })),
    ...batches.map((row) => ({
      key: `payment-${row.id}`,
      title: `دفعة مورد #${row.id}`,
      amount: row.amount,
      cash_amount: row.cash_amount,
      payment_method: row.payment_method,
      created_at: row.created_at,
      created_by_name: row.created_by_name,
      cancelled_at: row.cancelled_at,
      cancelled_by_name: row.cancelled_by_name,
      cancel_reason: row.cancel_reason,
      replacement_batch_id: row.replacement_batch_id,
      allocations: allocationsFor('payment', row.id),
      cash_movements: movementsFor('payment', row.id),
      events: eventsFor('payment', row.id),
    })),
  ];
}
