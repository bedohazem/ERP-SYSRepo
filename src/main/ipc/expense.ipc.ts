import { ipcMain } from 'electron'

import {
  cancelExpense,
  createExpense,
  listExpensesPage,
  listExpenses,
  updateExpense,
} from '../database/repositories/expense.repo'

import { requireAdminPassword } from './permission-helper'
import { requireAuthenticatedUser } from '../auth-session'

export function registerExpenseIpc(): void {
  ipcMain.handle('expenses:create', (event, input) => {
    const user = requireAuthenticatedUser(event)

    return createExpense({
      ...input,
      created_by: user.id,
    })
  })

  ipcMain.handle('expenses:list', (event, input) => {
    const user = requireAuthenticatedUser(event)

    return listExpenses({
      ...input,

      created_by: user.role === 'admin' ? undefined : user.id,
    })
  })

  ipcMain.handle('expenses:list-page', (event, input) => {
    const user = requireAuthenticatedUser(event)

    return listExpensesPage({
      ...input,

      created_by: user.role === 'admin' ? undefined : user.id,
    })
  })

  ipcMain.handle('expenses:update', (_, input) => {
    try {
      requireAdminPassword(input?.actor_id, input?.admin_password)

      return updateExpense({
        id: Number(input?.id),

        title: input?.title,

        category: input?.category,

        amount: Number(input?.amount),

        payment_method: input?.payment_method,

        notes: input?.notes,

        actor_id: input?.actor_id ?? null,
      })
    } catch (error) {
      return {
        success: false,

        message: error instanceof Error ? error.message : 'تعذر تعديل المصروف',
      }
    }
  })

  ipcMain.handle('expenses:cancel', (_, input) => {
    try {
      requireAdminPassword(input?.actor_id, input?.admin_password)

      return cancelExpense({
        id: Number(input?.id),
        reason: input?.reason,
        actor_id: input?.actor_id ?? null,
      })
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'تعذر إلغاء المصروف',
      }
    }
  })
}
