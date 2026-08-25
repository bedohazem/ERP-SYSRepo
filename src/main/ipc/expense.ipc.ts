import { ipcMain } from 'electron'

import {
  cancelExpense,
  createExpense,
  listExpensesPage,
  listExpenses,
} from '../database/repositories/expense.repo'

import { requireAdminPassword } from './permission-helper'

export function registerExpenseIpc(): void {
  ipcMain.handle('expenses:create', (_, input) => {
    return createExpense(input)
  })

  ipcMain.handle('expenses:list', (_, input) => {
    return listExpenses(input)
  })

  ipcMain.handle('expenses:list-page', (_, input) => {
    return listExpensesPage(input)
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
