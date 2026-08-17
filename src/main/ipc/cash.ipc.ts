import { ipcMain } from 'electron'

import {
  closeCashDay,
  createCashMovement,
  createCashTransfer,
  getCashDayClosePreview,
  getCashSummary,
  listCashMovements,
} from '../database/repositories/cash.repo'

export function registerCashIpc(): void {
  ipcMain.handle('cash:summary', (_, input) => {
    return getCashSummary(input)
  })

  ipcMain.handle('cash:transfer', (_, input) => {
    return createCashTransfer(input)
  })

  ipcMain.handle('cash:list', (_, input) => {
    return listCashMovements(input)
  })

  ipcMain.handle('cash:create-movement', (_, input) => {
    return createCashMovement(input)
  })

  ipcMain.handle('cash:day-close-preview', (_, businessDate: string) => {
    return getCashDayClosePreview(businessDate)
  })

  ipcMain.handle('cash:close-day', (_, input) => {
    return closeCashDay(input)
  })
}
