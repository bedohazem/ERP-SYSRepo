import { beforeEach, describe, expect, it } from 'vitest';
import { closeDb, getDb, resetDatabaseData } from '../../src/main/database/db';
import {
  cancelLiability,
  createLiability,
  getLiabilitiesSummary,
  getLiabilityStatement,
  listLiabilities,
  recordLiabilityPayment
} from '../../src/main/database/repositories/liabilities.repo';

type LiabilityTestRow = {
  id: number;
  party_name: string;
  title: string;
  category: string | null;
  total_amount: number;
  paid_amount: number;
  remaining_amount: number;
  status: 'open' | 'paid' | 'cancelled';
  due_date: string | null;
  notes: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
  payments_count?: number;
};

function getCashMovementTotal(direction: 'in' | 'out') {
  const db = getDb();

  const row = db
    .prepare(
      `
      SELECT IFNULL(SUM(amount), 0) AS total
      FROM cash_movements
      WHERE direction = ?
      `
    )
    .get(direction) as { total: number };

  return Number(row.total || 0);
}

function getLiabilityById(id: number) {
  const db = getDb();

  return db
    .prepare(
      `
      SELECT *
      FROM store_liabilities
      WHERE id = ?
      LIMIT 1
      `
    )
    .get(id) as LiabilityTestRow;
}

function getLiabilityPaymentsCount(liabilityId: number) {
  const db = getDb();

  const row = db
    .prepare(
      `
      SELECT COUNT(*) AS count
      FROM store_liability_payments
      WHERE liability_id = ?
      `
    )
    .get(liabilityId) as { count: number };

  return Number(row.count || 0);
}

function getActivityLogsCount() {
  const db = getDb();

  const row = db
    .prepare(
      `
      SELECT COUNT(*) AS count
      FROM activity_logs
      `
    )
    .get() as { count: number };

  return Number(row.count || 0);
}

describe('liabilities repository', () => {
  beforeEach(() => {
    closeDb();
    getDb();
    resetDatabaseData();
  });

  it('creates an open liability without initial payment', () => {
    const result = createLiability({
      party_name: 'Office Owner',
      title: 'Shop Rent',
      category: 'rent',
      total_amount: 1000,
      paid_amount: 0,
      payment_method: 'cash',
      due_date: '2026-06-30',
      notes: 'Monthly rent',
      actor_id: 1
    });

    expect(result.success).toBe(true);
    expect(result.liability_id).toBeGreaterThan(0);

    const liability = result.liability as LiabilityTestRow;

    expect(liability.party_name).toBe('Office Owner');
    expect(liability.title).toBe('Shop Rent');
    expect(liability.category).toBe('rent');
    expect(liability.total_amount).toBe(1000);
    expect(liability.paid_amount).toBe(0);
    expect(liability.remaining_amount).toBe(1000);
    expect(liability.status).toBe('open');

    expect(getCashMovementTotal('out')).toBe(0);
    expect(getLiabilityPaymentsCount(result.liability_id)).toBe(0);
    expect(getActivityLogsCount()).toBe(1);
  });

  it('rejects liability with empty party name', () => {
    expect(() =>
      createLiability({
        party_name: '   ',
        title: 'Shop Rent',
        total_amount: 1000
      })
    ).toThrow('اسم الشخص أو الجهة مطلوب');
  });

  it('rejects liability with empty title', () => {
    expect(() =>
      createLiability({
        party_name: 'Office Owner',
        title: '   ',
        total_amount: 1000
      })
    ).toThrow('عنوان الالتزام مطلوب');
  });

  it('rejects liability with invalid total amount', () => {
    expect(() =>
      createLiability({
        party_name: 'Office Owner',
        title: 'Shop Rent',
        total_amount: 0
      })
    ).toThrow('قيمة الالتزام غير صحيحة');
  });

  it('creates liability with initial payment and cash movement', () => {
    const result = createLiability({
      party_name: 'Supplier Person',
      title: 'Old Debt',
      category: 'debt',
      total_amount: 1000,
      paid_amount: 300,
      payment_method: 'cash',
      actor_id: 1
    });

    expect(result.success).toBe(true);

    const liability = getLiabilityById(result.liability_id);

    expect(liability.total_amount).toBe(1000);
    expect(liability.paid_amount).toBe(300);
    expect(liability.remaining_amount).toBe(700);
    expect(liability.status).toBe('open');

    expect(getLiabilityPaymentsCount(result.liability_id)).toBe(1);
    expect(getCashMovementTotal('out')).toBe(300);
  });

  it('caps initial payment to total amount', () => {
    const result = createLiability({
      party_name: 'Supplier Person',
      title: 'Full Paid Debt',
      total_amount: 500,
      paid_amount: 900,
      payment_method: 'cash',
      actor_id: 1
    });

    const liability = getLiabilityById(result.liability_id);

    expect(liability.total_amount).toBe(500);
    expect(liability.paid_amount).toBe(500);
    expect(liability.remaining_amount).toBe(0);
    expect(liability.status).toBe('paid');

    expect(getCashMovementTotal('out')).toBe(500);
  });

  it('records liability payment and updates remaining amount', () => {
    const result = createLiability({
      party_name: 'Office Owner',
      title: 'Shop Rent',
      total_amount: 1000,
      paid_amount: 0,
      payment_method: 'cash',
      actor_id: 1
    });

    const payment = recordLiabilityPayment({
      liability_id: result.liability_id,
      amount: 400,
      payment_method: 'cash',
      notes: 'Partial liability payment',
      actor_id: 1
    });

    expect(payment.success).toBe(true);
    expect(payment.payment_id).toBeGreaterThan(0);
    expect(payment.paid_amount).toBe(400);
    expect(payment.remaining_amount).toBe(600);
    expect(payment.status).toBe('open');

    const liability = getLiabilityById(result.liability_id);

    expect(liability.paid_amount).toBe(400);
    expect(liability.remaining_amount).toBe(600);
    expect(liability.status).toBe('open');

    expect(getLiabilityPaymentsCount(result.liability_id)).toBe(1);
    expect(getCashMovementTotal('out')).toBe(400);
  });

  it('marks liability as paid when fully paid', () => {
    const result = createLiability({
      party_name: 'Office Owner',
      title: 'Shop Rent',
      total_amount: 1000,
      paid_amount: 400,
      payment_method: 'cash',
      actor_id: 1
    });

    const payment = recordLiabilityPayment({
      liability_id: result.liability_id,
      amount: 600,
      payment_method: 'cash',
      actor_id: 1
    });

    expect(payment.success).toBe(true);
    expect(payment.paid_amount).toBe(1000);
    expect(payment.remaining_amount).toBe(0);
    expect(payment.status).toBe('paid');

    const liability = getLiabilityById(result.liability_id);

    expect(liability.paid_amount).toBe(1000);
    expect(liability.remaining_amount).toBe(0);
    expect(liability.status).toBe('paid');
    expect(getCashMovementTotal('out')).toBe(1000);
  });

  it('rejects liability payment with invalid amount', () => {
    const result = createLiability({
      party_name: 'Office Owner',
      title: 'Shop Rent',
      total_amount: 1000
    });

    expect(() =>
      recordLiabilityPayment({
        liability_id: result.liability_id,
        amount: 0,
        payment_method: 'cash'
      })
    ).toThrow('مبلغ الدفعة غير صحيح');
  });

  it('rejects liability payment greater than remaining amount', () => {
    const result = createLiability({
      party_name: 'Office Owner',
      title: 'Shop Rent',
      total_amount: 1000,
      paid_amount: 200,
      payment_method: 'cash'
    });

    expect(() =>
      recordLiabilityPayment({
        liability_id: result.liability_id,
        amount: 900,
        payment_method: 'cash'
      })
    ).toThrow('مبلغ الدفعة أكبر من المتبقي');

    const liability = getLiabilityById(result.liability_id);

    expect(liability.paid_amount).toBe(200);
    expect(liability.remaining_amount).toBe(800);
  });

  it('lists liabilities and filters by status and search', () => {
    const first = createLiability({
      party_name: 'Office Owner',
      title: 'Shop Rent',
      category: 'rent',
      total_amount: 1000
    });

    createLiability({
      party_name: 'Internet Company',
      title: 'Internet Bill',
      category: 'utilities',
      total_amount: 500,
      paid_amount: 500,
      payment_method: 'cash'
    });

    const allRows = listLiabilities() as LiabilityTestRow[];
    const openRows = listLiabilities({ status: 'open' }) as LiabilityTestRow[];
    const paidRows = listLiabilities({ status: 'paid' }) as LiabilityTestRow[];
    const searchRows = listLiabilities({ search: 'Rent' }) as LiabilityTestRow[];

    expect(allRows.length).toBeGreaterThanOrEqual(2);
    expect(openRows.every((row) => row.status === 'open')).toBe(true);
    expect(paidRows.every((row) => row.status === 'paid')).toBe(true);

    expect(searchRows).toHaveLength(1);
    expect(searchRows[0].id).toBe(first.liability_id);
    expect(searchRows[0].payments_count).toBe(0);
  });

  it('returns liability statement with payments', () => {
    const result = createLiability({
      party_name: 'Office Owner',
      title: 'Shop Rent',
      total_amount: 1000,
      paid_amount: 200,
      payment_method: 'cash',
      actor_id: 1
    });

    recordLiabilityPayment({
      liability_id: result.liability_id,
      amount: 300,
      payment_method: 'cash',
      actor_id: 1
    });

    const statement = getLiabilityStatement(result.liability_id) as any;

    expect(statement.liability.id).toBe(result.liability_id);
    expect(statement.payments).toHaveLength(2);
    expect(statement.payments[0].amount).toBe(300);
    expect(statement.payments[1].amount).toBe(200);
  });

  it('cancels liability without payments', () => {
    const result = createLiability({
      party_name: 'Office Owner',
      title: 'Cancelable Liability',
      total_amount: 1000,
      paid_amount: 0,
      actor_id: 1
    });

    const cancelResult = cancelLiability({
      id: result.liability_id,
      actor_id: 1
    });

    expect(cancelResult.success).toBe(true);

    const liability = getLiabilityById(result.liability_id);

    expect(liability.status).toBe('cancelled');

    const summary = getLiabilitiesSummary();
    expect(summary.count).toBe(0);
  });

  it('rejects cancelling liability with payments', () => {
    const result = createLiability({
      party_name: 'Office Owner',
      title: 'Non Cancelable Liability',
      total_amount: 1000,
      paid_amount: 100,
      payment_method: 'cash',
      actor_id: 1
    });

    expect(() =>
      cancelLiability({
        id: result.liability_id,
        actor_id: 1
      })
    ).toThrow('لا يمكن إلغاء التزام عليه دفعات');

    const liability = getLiabilityById(result.liability_id);

    expect(liability.status).toBe('open');
  });

  it('rejects payment on cancelled liability', () => {
    const result = createLiability({
      party_name: 'Office Owner',
      title: 'Cancelled Liability',
      total_amount: 1000,
      paid_amount: 0,
      actor_id: 1
    });

    cancelLiability({
      id: result.liability_id,
      actor_id: 1
    });

    expect(() =>
      recordLiabilityPayment({
        liability_id: result.liability_id,
        amount: 100,
        payment_method: 'cash',
        actor_id: 1
      })
    ).toThrow('لا يمكن تسجيل دفعة على التزام ملغي');
  });

  it('returns liabilities summary', () => {
    createLiability({
      party_name: 'Office Owner',
      title: 'Shop Rent',
      total_amount: 1000,
      paid_amount: 300,
      payment_method: 'cash'
    });

    createLiability({
      party_name: 'Internet Company',
      title: 'Internet Bill',
      total_amount: 500,
      paid_amount: 500,
      payment_method: 'cash'
    });

    const summary = getLiabilitiesSummary();

    expect(summary.total_liabilities).toBe(1500);
    expect(summary.total_paid).toBe(800);
    expect(summary.total_remaining).toBe(700);
    expect(summary.paid_in_period).toBe(800);
    expect(summary.count).toBe(2);
  });
});