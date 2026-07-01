import { getDb } from '../db';
import { createCashMovement } from './cash.repo';
import { createActivityLog } from './activity.repo';
import { enqueueSyncOperation } from './sync.repo';

export type CreateExpenseInput = {
  title: string;
  category?: string | null;
  amount: number;
  payment_method?: string;
  notes?: string | null;
  created_by?: number | null;
};

export function createExpense(input: CreateExpenseInput) {
  const db = getDb();

  const title = input.title?.trim();

  if (!title) {
    throw new Error('عنوان المصروف مطلوب');
  }

  const amount = Number(input.amount || 0);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('قيمة المصروف غير صحيحة');
  }

  const tx = db.transaction(() => {
    const result = db
      .prepare(`
        INSERT INTO expenses (
          title,
          category,
          amount,
          payment_method,
          notes,
          created_by
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(
        title,
        input.category?.trim() || null,
        amount,
        input.payment_method || 'cash',
        input.notes?.trim() || null,
        input.created_by ?? null
      );

    const expenseId = Number(result.lastInsertRowid);


    createActivityLog({
      user_id: input.created_by ?? null,
      action: 'expense_created',
      entity: 'expenses',
      entity_id: expenseId,
      details: JSON.stringify({
        title,
        category: input.category?.trim() || null,
        amount,
        payment_method: input.payment_method || 'cash',
        notes: input.notes?.trim() || null
      })
    });

    createCashMovement({
      type: 'expense',
      direction: 'out',
      amount,
      payment_method: input.payment_method || 'cash',
      reference_id: expenseId,
      reference_type: 'expense',
      notes: `مصروف: ${title}`,
      created_by: input.created_by ?? null
    });

    const savedExpense = db
      .prepare(`SELECT * FROM expenses WHERE id = ? LIMIT 1`)
      .get(expenseId);

    enqueueSyncOperation({
      type: 'expense.created',
      entity: 'expenses',
      entity_id: expenseId,
      payload: {
        expense: savedExpense,
        cash: {
          direction: 'out',
          amount,
          payment_method: input.payment_method || 'cash',
          reference_type: 'expense',
          reference_id: expenseId
        }
      }
    });

    return {
      id: expenseId,
      success: true
    };
  });

  return tx();
}

export function listExpenses() {
  const db = getDb();

  return db
    .prepare(`
      SELECT
        e.*,
        u.name AS created_by_name
      FROM expenses e
      LEFT JOIN users u ON u.id = e.created_by
      ORDER BY e.id DESC
    `)
    .all();
}