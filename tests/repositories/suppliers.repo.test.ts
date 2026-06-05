import { beforeEach, describe, expect, it } from 'vitest';
import { closeDb, getDb, resetDatabaseData } from '../../src/main/database/db';
import {
  createSupplier,
  deleteSupplier,
  getSupplierById,
  getSuppliers,
  updateSupplier
} from '../../src/main/database/repositories/suppliers.repo';

type SupplierTestRow = {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  balance: number;
  total_purchased: number;
  is_active: number;
  created_at: string;
  updated_at: string | null;
};

describe('suppliers repository', () => {
  beforeEach(() => {
    closeDb();
    getDb();
    resetDatabaseData();
  });

  it('creates a supplier and trims text fields', () => {
    const supplier = createSupplier({
      name: '  Test Supplier  ',
      phone: ' 01111111111 ',
      email: ' supplier@test.com ',
      address: ' Cairo ',
      notes: ' Main supplier '
    }) as SupplierTestRow;

    expect(supplier.id).toBeGreaterThan(0);
    expect(supplier.name).toBe('Test Supplier');
    expect(supplier.phone).toBe('01111111111');
    expect(supplier.email).toBe('supplier@test.com');
    expect(supplier.address).toBe('Cairo');
    expect(supplier.notes).toBe('Main supplier');
    expect(supplier.is_active).toBe(1);
    expect(supplier.balance).toBe(0);
    expect(supplier.total_purchased).toBe(0);
  });

  it('stores empty optional fields as null', () => {
    const supplier = createSupplier({
      name: 'Supplier With Empty Fields',
      phone: '   ',
      email: '',
      address: null,
      notes: undefined
    }) as SupplierTestRow;

    expect(supplier.name).toBe('Supplier With Empty Fields');
    expect(supplier.phone).toBeNull();
    expect(supplier.email).toBeNull();
    expect(supplier.address).toBeNull();
    expect(supplier.notes).toBeNull();
  });

  it('rejects supplier with empty name', () => {
    expect(() =>
      createSupplier({
        name: '   ',
        phone: '01111111111'
      })
    ).toThrow('اسم المورد مطلوب');
  });

  it('gets supplier by id', () => {
    const supplier = createSupplier({
      name: 'Supplier By ID',
      phone: '01122222222'
    }) as SupplierTestRow;

    const found = getSupplierById(supplier.id) as SupplierTestRow;

    expect(found.id).toBe(supplier.id);
    expect(found.name).toBe('Supplier By ID');
    expect(found.phone).toBe('01122222222');
  });

  it('lists suppliers ordered by newest first', () => {
    const first = createSupplier({
      name: 'First Supplier',
      phone: '01133333333'
    }) as SupplierTestRow;

    const second = createSupplier({
      name: 'Second Supplier',
      phone: '01144444444'
    }) as SupplierTestRow;

    const suppliers = getSuppliers() as SupplierTestRow[];

    expect(suppliers).toHaveLength(2);
    expect(suppliers[0].id).toBe(second.id);
    expect(suppliers[1].id).toBe(first.id);
  });

  it('searches suppliers by name phone email and address', () => {
    createSupplier({
      name: 'Search Supplier',
      phone: '01155555555',
      email: 'search-supplier@test.com',
      address: 'Alexandria'
    });

    expect(getSuppliers('Search') as SupplierTestRow[]).toHaveLength(1);
    expect(getSuppliers('011555') as SupplierTestRow[]).toHaveLength(1);
    expect(getSuppliers('search-supplier') as SupplierTestRow[]).toHaveLength(1);
    expect(getSuppliers('Alexandria') as SupplierTestRow[]).toHaveLength(1);
  });

  it('updates a supplier', () => {
    const supplier = createSupplier({
      name: 'Old Supplier',
      phone: '01166666666',
      email: 'old@test.com',
      address: 'Old Address',
      notes: 'Old notes'
    }) as SupplierTestRow;

    const updated = updateSupplier({
      id: supplier.id,
      name: 'Updated Supplier',
      phone: '01177777777',
      email: 'updated@test.com',
      address: 'Updated Address',
      notes: 'Updated notes'
    }) as SupplierTestRow;

    expect(updated.id).toBe(supplier.id);
    expect(updated.name).toBe('Updated Supplier');
    expect(updated.phone).toBe('01177777777');
    expect(updated.email).toBe('updated@test.com');
    expect(updated.address).toBe('Updated Address');
    expect(updated.notes).toBe('Updated notes');
  });

  it('rejects updating supplier without id', () => {
    expect(() =>
      updateSupplier({
        id: 0,
        name: 'Invalid Supplier',
        phone: '01188888888'
      })
    ).toThrow('Supplier ID is required');
  });

  it('rejects updating supplier with empty name', () => {
    const supplier = createSupplier({
      name: 'Valid Supplier',
      phone: '01199999999'
    }) as SupplierTestRow;

    expect(() =>
      updateSupplier({
        id: supplier.id,
        name: '   ',
        phone: supplier.phone
      })
    ).toThrow('اسم المورد مطلوب');
  });

  it('soft deletes supplier and hides it from active list', () => {
    const supplier = createSupplier({
      name: 'Supplier To Delete',
      phone: '01011111111'
    }) as SupplierTestRow;

    const result = deleteSupplier(supplier.id);

    expect(result.ok).toBe(true);

    const deleted = getSupplierById(supplier.id) as SupplierTestRow;
    expect(deleted.is_active).toBe(0);

    const suppliers = getSuppliers() as SupplierTestRow[];
    expect(suppliers.some((item) => item.id === supplier.id)).toBe(false);
  });

  it('does not return inactive suppliers in search', () => {
    const supplier = createSupplier({
      name: 'Inactive Search Supplier',
      phone: '01022222222'
    }) as SupplierTestRow;

    deleteSupplier(supplier.id);

    const results = getSuppliers('Inactive Search') as SupplierTestRow[];

    expect(results).toHaveLength(0);
  });
});