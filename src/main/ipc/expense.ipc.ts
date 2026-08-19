import { ipcMain } from 'electron'

import {
  createExpense,
  listExpensesPage,
  listExpenses,
} from '../database/repositories/expense.repo'

export function registerExpenseIpc(): void {
  ipcMain.handle('expenses:create', (_, input) => {
    return createExpense(input)
  })

  ipcMain.handle('expenses:list', () => {
    return listExpenses()
  })

  ipcMain.handle('expenses:list-page', (_, input) => {
    return listExpensesPage(input)
  })
}
