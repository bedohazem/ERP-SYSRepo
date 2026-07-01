import { getDb } from '../db';
import { createCashMovement } from './cash.repo';
import { createActivityLog } from './activity.repo';
import { enqueueSyncOperation } from './sync.repo';

export type CreateLiabilityInput = {
  party_name: string;
  title: string;
  category?: string | null;
  total_amount: number;
  paid_amount?: number;
  payment_method?: string;
  due_date?: string | null;
  notes?: string | null;
  actor_id?: number | null;
};

export type RecordLiabilityPaymentInput = {
  liability_id: number;
  amount: number;
  payment_method?: string;
  notes?: string | null;
  actor_id?: number | null;
};

function cleanText(value: unknown) {
  return String(value || '').trim();
}

function getLiabilityByIdOrThrow(id: number) {
  const db = getDb();

  const row = db
    .prepare(`SELECT * FROM store_liabilities WHERE id = ? LIMIT 1`)
    .get(id) as any;

  if (!row) {
    throw new Error('الالتزام غير موجود');
  }

  return row;
}

function getStatus(remaining: number) {
  return remaining <= 0 ? 'paid' : 'open';
}

export function createLiability(input: CreateLiabilityInput) {
  const db = getDb();

  const partyName = cleanText(input.party_name);
  const title = cleanText(input.title);
  const totalAmount = Number(input.total_amount || 0);
  const initialPaid = Math.min(Math.max(Number(input.paid_amount || 0), 0), totalAmount);

  if (!partyName) {
    throw new Error('اسم الشخص أو الجهة مطلوب');
  }

  if (!title) {
    throw new Error('عنوان الالتزام مطلوب');
  }

  if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
    throw new Error('قيمة الالتزام غير صحيحة');
  }

  const tx = db.transaction(() => {
    const result = db
      .prepare(`
        INSERT INTO store_liabilities (
          party_name,
          title,
          category,
          total_amount,
          paid_amount,
          remaining_amount,
          status,
          due_date,
          notes,
          created_by,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `)
      .run(
        partyName,
        title,
        cleanText(input.category) || null,
        totalAmount,
        0,
        totalAmount,
        'open',
        input.due_date || null,
        cleanText(input.notes) || null,
        input.actor_id ?? null
      );

    const liabilityId = Number(result.lastInsertRowid);

    createActivityLog({
      user_id: input.actor_id ?? null,
      action: 'liability_created',
      entity: 'store_liabilities',
      entity_id: liabilityId,
      details: JSON.stringify({
        party_name: partyName,
        title,
        total_amount: totalAmount,
        initial_paid: initialPaid,
        remaining_amount: totalAmount
      })
    });

    if (initialPaid > 0) {
      recordLiabilityPayment({
        liability_id: liabilityId,
        amount: initialPaid,
        payment_method: input.payment_method || 'cash',
        notes: 'دفعة مبدئية عند إنشاء الالتزام',
        actor_id: input.actor_id ?? null
      });
    }
    const liability = getLiabilityByIdOrThrow(liabilityId);

    enqueueSyncOperation({
      type: 'liability.created',
      entity: 'store_liabilities',
      entity_id: liabilityId,
      payload: {
        liability,
        initial_paid: initialPaid,
        note: 'التزام سابق / متابعة سداد فقط'
      }
    });

    return {
      success: true,
      liability_id: liabilityId,
      liability
    };
  });

  return tx();
}

export function recordLiabilityPayment(input: RecordLiabilityPaymentInput) {
  const db = getDb();

  const liability = getLiabilityByIdOrThrow(Number(input.liability_id));
  const amount = Number(input.amount || 0);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('مبلغ الدفعة غير صحيح');
  }

  if (liability.status === 'cancelled') {
    throw new Error('لا يمكن تسجيل دفعة على التزام ملغي');
  }

  const remainingBefore = Number(liability.remaining_amount || 0);

  if (amount > remainingBefore) {
    throw new Error('مبلغ الدفعة أكبر من المتبقي');
  }

  const tx = db.transaction(() => {
    const paymentResult = db
      .prepare(`
        INSERT INTO store_liability_payments (
          liability_id,
          amount,
          payment_method,
          notes,
          created_by
        )
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(
        liability.id,
        amount,
        input.payment_method || 'cash',
        cleanText(input.notes) || null,
        input.actor_id ?? null
      );

    const paymentId = Number(paymentResult.lastInsertRowid);

    const nextPaid = Number(liability.paid_amount || 0) + amount;
    const nextRemaining = Math.max(0, Number(liability.total_amount || 0) - nextPaid);
    const nextStatus = getStatus(nextRemaining);

    db.prepare(`
      UPDATE store_liabilities
      SET
        paid_amount = ?,
        remaining_amount = ?,
        status = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(nextPaid, nextRemaining, nextStatus, liability.id);

    createCashMovement({
      type: 'liability_payment',
      direction: 'out',
      amount,
      payment_method: input.payment_method || 'cash',
      reference_id: paymentId,
      reference_type: 'store_liability_payment',
      notes: `سداد التزام: ${liability.title} - ${liability.party_name}`,
      created_by: input.actor_id ?? null
    });

    const savedPayment = db
      .prepare(`SELECT * FROM store_liability_payments WHERE id = ? LIMIT 1`)
      .get(paymentId);

    const savedLiability = getLiabilityByIdOrThrow(liability.id);

    enqueueSyncOperation({
      type: 'liability_payment.created',
      entity: 'store_liability_payments',
      entity_id: paymentId,
      payload: {
        payment: savedPayment,
        liability: savedLiability,
        cash: {
          direction: 'out',
          amount,
          payment_method: input.payment_method || 'cash',
          reference_type: 'store_liability_payment',
          reference_id: paymentId
        }
      }
    });

    createActivityLog({
      user_id: input.actor_id ?? null,
      action: 'liability_payment_created',
      entity: 'store_liability_payments',
      entity_id: paymentId,
      details: JSON.stringify({
        liability_id: liability.id,
        title: liability.title,
        party_name: liability.party_name,
        amount,
        remaining_after: nextRemaining
      })
    });

    return {
      success: true,
      payment_id: paymentId,
      liability_id: liability.id,
      paid_amount: nextPaid,
      remaining_amount: nextRemaining,
      status: nextStatus
    };
  });

  return tx();
}

export function listLiabilities(input?: { search?: string; status?: string }) {
  const db = getDb();

  const where: string[] = [];
  const params: any[] = [];

  if (input?.status && input.status !== 'all') {
    where.push(`l.status = ?`);
    params.push(input.status);
  }

  if (input?.search?.trim()) {
    where.push(`(
      l.party_name LIKE ?
      OR l.title LIKE ?
      OR l.category LIKE ?
      OR l.notes LIKE ?
    )`);

    const search = `%${input.search.trim()}%`;
    params.push(search, search, search, search);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  return db
    .prepare(`
      SELECT
        l.*,
        u.name AS created_by_name,
        (
          SELECT COUNT(*)
          FROM store_liability_payments p
          WHERE p.liability_id = l.id
        ) AS payments_count
      FROM store_liabilities l
      LEFT JOIN users u ON u.id = l.created_by
      ${whereSql}
      ORDER BY l.id DESC
      LIMIT 500
    `)
    .all(...params);
}

export function getLiabilityStatement(liabilityId: number) {
  const db = getDb();
  const liability = getLiabilityByIdOrThrow(liabilityId);

  const payments = db
    .prepare(`
      SELECT
        p.*,
        u.name AS created_by_name
      FROM store_liability_payments p
      LEFT JOIN users u ON u.id = p.created_by
      WHERE p.liability_id = ?
      ORDER BY p.id DESC
    `)
    .all(liabilityId);

  return {
    liability,
    payments
  };
}

export function cancelLiability(input: { id: number; actor_id?: number | null }) {
  const db = getDb();
  const liability = getLiabilityByIdOrThrow(Number(input.id));

  if (Number(liability.paid_amount || 0) > 0) {
    throw new Error('لا يمكن إلغاء التزام عليه دفعات');
  }

  db.prepare(`
    UPDATE store_liabilities
    SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(liability.id);

  createActivityLog({
    user_id: input.actor_id ?? null,
    action: 'liability_cancelled',
    entity: 'store_liabilities',
    entity_id: liability.id,
    details: JSON.stringify({
      title: liability.title,
      party_name: liability.party_name,
      total_amount: liability.total_amount
    })
  });

  return {
    success: true
  };
}

export function getLiabilitiesSummary(input?: { date_from?: string; date_to?: string }) {
  const db = getDb();

  const where: string[] = [];
  const params: any[] = [];

  if (input?.date_from) {
    where.push(`datetime(p.created_at, 'localtime') >= datetime(?)`);
    params.push(`${input.date_from} 00:00:00`);
  }

  if (input?.date_to) {
    where.push(`datetime(p.created_at, 'localtime') <= datetime(?)`);
    params.push(`${input.date_to} 23:59:59`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const paidRow = db
    .prepare(`
      SELECT IFNULL(SUM(p.amount), 0) AS paid_total
      FROM store_liability_payments p
      ${whereSql}
    `)
    .get(...params) as any;

  const totalsRow = db
    .prepare(`
      SELECT
        IFNULL(SUM(total_amount), 0) AS total_liabilities,
        IFNULL(SUM(paid_amount), 0) AS total_paid,
        IFNULL(SUM(remaining_amount), 0) AS total_remaining,
        COUNT(*) AS count
      FROM store_liabilities
      WHERE status != 'cancelled'
    `)
    .get() as any;

  return {
    paid_in_period: Number(paidRow.paid_total || 0),
    total_liabilities: Number(totalsRow.total_liabilities || 0),
    total_paid: Number(totalsRow.total_paid || 0),
    total_remaining: Number(totalsRow.total_remaining || 0),
    count: Number(totalsRow.count || 0)
  };
}