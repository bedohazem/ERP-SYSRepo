import { beforeEach, describe, expect, it } from 'vitest';
import { closeDb, getDb, resetDatabaseData } from '../../src/main/database/db';
import {
  createCashMovement,
  getCashSummary,
  listCashMovements
} from '../../src/main/database/repositories/cash.repo';

type CashMovementTestRow = {
  id: number;
  type: string;
  amount: number;
  direction: 'in' | 'out';
  payment_method: string;
  reference_id: number | null;
  reference_type: string | null;
  notes: string | null;
  created_by: number | null;
  created_at: string;
  created_by_name?: string | null;
};

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

function getLastActivityLog() {
  const db = getDb();

  return db
    .prepare(
      `
      SELECT *
      FROM activity_logs
      ORDER BY id DESC
      LIMIT 1
      `
    )
    .get() as any;
}

describe('cash repository', () => {
  beforeEach(() => {
    closeDb();
    getDb();
    resetDatabaseData();
  });

  it('creates cash in movement and updates summary', () => {
    const result = createCashMovement({
      type: 'deposit',
      direction: 'in',
      amount: 500,
      payment_method: 'cash',
      notes: 'Opening cash deposit',
      created_by: 1
    });

    expect(Number(result.lastInsertRowid)).toBeGreaterThan(0);

    const summary = getCashSummary();

    expect(summary.total_in).toBe(500);
    expect(summary.total_out).toBe(0);
    expect(summary.balance).toBe(500);
    expect(summary.movements_count).toBe(1);
  });

  it('creates cash out movement and updates summary balance', () => {
    createCashMovement({
      type: 'deposit',
      direction: 'in',
      amount: 500,
      payment_method: 'cash',
      notes: 'Cash in',
      created_by: 1
    });

    createCashMovement({
      type: 'expense',
      direction: 'out',
      amount: 200,
      payment_method: 'cash',
      notes: 'Cash out',
      created_by: 1
    });

    const summary = getCashSummary();

    expect(summary.total_in).toBe(500);
    expect(summary.total_out).toBe(200);
    expect(summary.balance).toBe(300);
    expect(summary.movements_count).toBe(2);
  });

  it('lists cash movements ordered by newest first', () => {
    createCashMovement({
      type: 'deposit',
      direction: 'in',
      amount: 100,
      payment_method: 'cash',
      notes: 'First movement',
      created_by: 1
    });

    createCashMovement({
      type: 'withdraw',
      direction: 'out',
      amount: 50,
      payment_method: 'cash',
      notes: 'Second movement',
      created_by: 1
    });

    const rows = listCashMovements() as CashMovementTestRow[];

    expect(rows).toHaveLength(2);
    expect(rows[0].notes).toBe('Second movement');
    expect(rows[1].notes).toBe('First movement');
  });

  it('filters cash movements by direction', () => {
    createCashMovement({
      type: 'deposit',
      direction: 'in',
      amount: 300,
      payment_method: 'cash',
      notes: 'Only in',
      created_by: 1
    });

    createCashMovement({
      type: 'expense',
      direction: 'out',
      amount: 100,
      payment_method: 'cash',
      notes: 'Only out',
      created_by: 1
    });

    const inRows = listCashMovements({ direction: 'in' }) as CashMovementTestRow[];
    const outRows = listCashMovements({ direction: 'out' }) as CashMovementTestRow[];

    expect(inRows).toHaveLength(1);
    expect(inRows[0].direction).toBe('in');

    expect(outRows).toHaveLength(1);
    expect(outRows[0].direction).toBe('out');
  });

  it('filters cash movements by type and payment method', () => {
    createCashMovement({
      type: 'deposit',
      direction: 'in',
      amount: 300,
      payment_method: 'cash',
      notes: 'Cash deposit',
      created_by: 1
    });

    createCashMovement({
      type: 'customer_payment',
      direction: 'in',
      amount: 200,
      payment_method: 'card',
      notes: 'Card customer payment',
      created_by: 1
    });

    const depositRows = listCashMovements({ type: 'deposit' }) as CashMovementTestRow[];
    const cardRows = listCashMovements({ payment_method: 'card' }) as CashMovementTestRow[];

    expect(depositRows).toHaveLength(1);
    expect(depositRows[0].type).toBe('deposit');

    expect(cardRows).toHaveLength(1);
    expect(cardRows[0].payment_method).toBe('card');
  });

  it('searches cash movements by notes', () => {
    createCashMovement({
      type: 'deposit',
      direction: 'in',
      amount: 300,
      payment_method: 'cash',
      notes: 'Special searchable note',
      created_by: 1
    });

    createCashMovement({
      type: 'expense',
      direction: 'out',
      amount: 50,
      payment_method: 'cash',
      notes: 'Other note',
      created_by: 1
    });

    const rows = listCashMovements({ search: 'searchable' }) as CashMovementTestRow[];

    expect(rows).toHaveLength(1);
    expect(rows[0].notes).toBe('Special searchable note');
  });

  it('creates activity log when cash movement is created', () => {
    expect(getActivityLogsCount()).toBe(0);

    createCashMovement({
      type: 'deposit',
      direction: 'in',
      amount: 500,
      payment_method: 'cash',
      notes: 'Movement with activity log',
      created_by: 1
    });

    expect(getActivityLogsCount()).toBe(1);

    const log = getLastActivityLog();

    expect(log.action).toBe('cash_in');
    expect(log.entity).toBe('cash_movements');
    expect(log.entity_id).toBeGreaterThan(0);
    expect(log.user_id).toBe(1);
  });

  it('rejects cash movement with zero amount', () => {
    expect(() =>
      createCashMovement({
        type: 'deposit',
        direction: 'in',
        amount: 0,
        payment_method: 'cash',
        notes: 'Invalid zero amount',
        created_by: 1
      })
    ).toThrow();
  });

  it('rejects cash movement with negative amount', () => {
    expect(() =>
      createCashMovement({
        type: 'deposit',
        direction: 'in',
        amount: -100,
        payment_method: 'cash',
        notes: 'Invalid negative amount',
        created_by: 1
      })
    ).toThrow();
  });

  it('rejects cash movement with invalid direction', () => {
    expect(() =>
      createCashMovement({
        type: 'deposit',
        direction: 'sideways' as any,
        amount: 100,
        payment_method: 'cash',
        notes: 'Invalid direction',
        created_by: 1
      })
    ).toThrow();
  });

  it('rejects cash movement with missing type', () => {
    expect(() =>
      createCashMovement({
        type: '' as any,
        direction: 'in',
        amount: 100,
        payment_method: 'cash',
        notes: 'Missing type',
        created_by: 1
      })
    ).toThrow();
  });


});