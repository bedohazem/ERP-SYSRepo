import { ipcMain } from 'electron';
import {
  adjustCustomerPoints,
  createCustomer,
  deleteCustomer,
  getCustomerById,
  getCustomerHistory,
  getCustomers,
  searchCustomers,
  updateCustomer,
  recordCustomerPayment,
  getCustomerStatement
} from '../database/repositories/customers.repo';

export function registerCustomersIpc(): void {
  ipcMain.handle('customers:list', () => {
    return getCustomers();
  });

  ipcMain.handle('customers:search', (_, query: string) => {
    return searchCustomers(query ?? '');
  });

  ipcMain.handle('customers:get-by-id', (_, id: number) => {
    return getCustomerById(Number(id));
  });

  ipcMain.handle('customers:create', (_, input) => {
    return createCustomer(input);
  });

  ipcMain.handle('customers:update', (_, input) => {
    return updateCustomer(input);
  });

  ipcMain.handle('customers:delete', (_, id: number) => {
    return deleteCustomer(Number(id));
  });

  ipcMain.handle('customers:history', (_, customerId: number) => {
    return getCustomerHistory(Number(customerId));
  });

  ipcMain.handle('customers:adjust-points', (_, input) => {
    return adjustCustomerPoints(input);
  });

  ipcMain.handle('customers:record-payment', (_, input) => {
    return recordCustomerPayment(input);
  });

  ipcMain.handle('customers:statement', (_, customerId: number) => {
    return getCustomerStatement(Number(customerId));
  });
  
}