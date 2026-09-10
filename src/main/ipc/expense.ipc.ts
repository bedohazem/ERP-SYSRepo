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

  ipcMain.handle('expenses:update', (event, input) => {
    try {
      const user = requireAuthenticatedUser(event)
      const isAdmin = user.role === 'admin'

      if (isAdmin) {
        requireAdminPassword(user.id, input?.admin_password)
      }

      return updateExpense({
        id: Number(input?.id),

        title: input?.title,

        category: input?.category,

        amount: Number(input?.amount),

        payment_method: input?.payment_method,

        notes: input?.notes,

        actor_id: user.id,

        can_manage_all: isAdmin,
      })
    } catch (error) {
      return {
        success: false,

        message: error instanceof Error ? error.message : 'تعذر تعديل المصروف',
      }
    }
  })

  ipcMain.handle('expenses:cancel', (event, input) => {
    try {
      const user = requireAuthenticatedUser(event)
      const isAdmin = user.role === 'admin'

      if (isAdmin) {
        requireAdminPassword(user.id, input?.admin_password)
      }

      return cancelExpense({
        id: Number(input?.id),
        reason: input?.reason,
        actor_id: user.id,
        can_manage_all: isAdmin,
      })
    } catch (error) {
      return {
        success: false,

        message: error instanceof Error ? error.message : 'تعذر إلغاء المصروف',
      }
    }
  })
}
