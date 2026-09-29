import { beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDb, resetDatabaseData } from '../../src/main/database/db'
import {
  createSupplier,
  deleteSupplier,
  getSupplierById,
  getSuppliers,
  listSuppliers,
  updateSupplier,
  getSupplierAgingSummary,
} from '../../src/main/database/repositories/suppliers.repo'

type SupplierTestRow = {
  id: number
  name: string
  phone: string | null
  email: string | null
  address: string | null
  notes: string | null
  balance: number
  total_purchased: number
  is_active: number
  created_at: string
  updated_at: string | null
  credit_days: number | null
}

describe('suppliers repository', () => {
  beforeEach(() => {
    closeDb()
    getDb()
    resetDatabaseData()
  })

  it('creates a supplier and trims text fields', () => {
    const supplier = createSupplier({
      name: '  Test Supplier  ',
      phone: ' 01111111111 ',
      email: ' supplier@test.com ',
      address: ' Cairo ',
      notes: ' Main supplier ',
    }) as SupplierTestRow

    expect(supplier.id).toBeGreaterThan(0)
    expect(supplier.name).toBe('Test Supplier')
    expect(supplier.phone).toBe('01111111111')
    expect(supplier.email).toBe('supplier@test.com')
    expect(supplier.address).toBe('Cairo')
    expect(supplier.notes).toBe('Main supplier')
    expect(supplier.is_active).toBe(1)
    expect(supplier.balance).toBe(0)
    expect(supplier.total_purchased).toBe(0)
  })

  it('stores empty optional fields as null', () => {
    const supplier = createSupplier({
      name: 'Supplier With Empty Fields',
      phone: '   ',
      email: '',
      address: null,
      notes: undefined,
    }) as SupplierTestRow

    expect(supplier.name).toBe('Supplier With Empty Fields')
    expect(supplier.phone).toBeNull()
    expect(supplier.email).toBeNull()
    expect(supplier.address).toBeNull()
    expect(supplier.notes).toBeNull()
  })

  it('rejects supplier with empty name', () => {
    expect(() =>
      createSupplier({
        name: '   ',
        phone: '01111111111',
      }),
    ).toThrow('اسم المورد مطلوب')
  })

  it('gets supplier by id', () => {
    const supplier = createSupplier({
      name: 'Supplier By ID',
      phone: '01122222222',
    }) as SupplierTestRow

    const found = getSupplierById(supplier.id) as SupplierTestRow

    expect(found.id).toBe(supplier.id)
    expect(found.name).toBe('Supplier By ID')
    expect(found.phone).toBe('01122222222')
  })

  it('lists suppliers ordered by newest first', () => {
    const first = createSupplier({
      name: 'First Supplier',
      phone: '01133333333',
    }) as SupplierTestRow

    const second = createSupplier({
      name: 'Second Supplier',
      phone: '01144444444',
    }) as SupplierTestRow

    const suppliers = getSuppliers() as SupplierTestRow[]

    expect(suppliers).toHaveLength(2)
    expect(suppliers[0].id).toBe(second.id)
    expect(suppliers[1].id).toBe(first.id)
  })

  it('searches suppliers by name phone email and address', () => {
    createSupplier({
      name: 'Search Supplier',
      phone: '01155555555',
      email: 'search-supplier@test.com',
      address: 'Alexandria',
    })

    expect(getSuppliers('Search') as SupplierTestRow[]).toHaveLength(1)
    expect(getSuppliers('011555') as SupplierTestRow[]).toHaveLength(1)
    expect(getSuppliers('search-supplier') as SupplierTestRow[]).toHaveLength(1)
    expect(getSuppliers('Alexandria') as SupplierTestRow[]).toHaveLength(1)
  })

  it('updates a supplier', () => {
    const supplier = createSupplier({
      name: 'Old Supplier',
      phone: '01166666666',
      email: 'old@test.com',
      address: 'Old Address',
      notes: 'Old notes',
    }) as SupplierTestRow

    const updated = updateSupplier({
      id: supplier.id,
      name: 'Updated Supplier',
      phone: '01177777777',
      email: 'updated@test.com',
      address: 'Updated Address',
      notes: 'Updated notes',
    }) as SupplierTestRow

    expect(updated.id).toBe(supplier.id)
    expect(updated.name).toBe('Updated Supplier')
    expect(updated.phone).toBe('01177777777')
    expect(updated.email).toBe('updated@test.com')
    expect(updated.address).toBe('Updated Address')
    expect(updated.notes).toBe('Updated notes')
  })

  it('stores and updates supplier credit terms', () => {
    const supplier = createSupplier({
      name: 'Terms Supplier',

      phone: '01066660001',

      credit_days: 45,
    }) as SupplierTestRow

    expect(supplier.credit_days).toBe(45)

    const updated = updateSupplier({
      id: supplier.id,

      name: supplier.name,

      phone: supplier.phone,

      credit_days: 15,
    }) as SupplierTestRow

    expect(updated.credit_days).toBe(15)

    const preserved = updateSupplier({
      id: supplier.id,

      name: supplier.name,

      phone: supplier.phone,
    }) as SupplierTestRow

    expect(preserved.credit_days).toBe(15)

    expect(() =>
      updateSupplier({
        id: supplier.id,

        name: supplier.name,

        phone: supplier.phone,

        credit_days: -1,
      }),
    ).toThrow('مدة الائتمان')

    expect(() =>
      updateSupplier({
        id: supplier.id,

        name: supplier.name,

        phone: supplier.phone,

        credit_days: 1.5,
      }),
    ).toThrow('مدة الائتمان')
  })

  it('rejects updating supplier without id', () => {
    expect(() =>
      updateSupplier({
        id: 0,
        name: 'Invalid Supplier',
        phone: '01188888888',
      }),
    ).toThrow('Supplier ID is required')
  })

  it('rejects updating supplier with empty name', () => {
    const supplier = createSupplier({
      name: 'Valid Supplier',
      phone: '01199999999',
    }) as SupplierTestRow

    expect(() =>
      updateSupplier({
        id: supplier.id,
        name: '   ',
        phone: supplier.phone,
      }),
    ).toThrow('اسم المورد مطلوب')
  })

  it('soft deletes supplier and hides it from active list', () => {
    const supplier = createSupplier({
      name: 'Supplier To Delete',
      phone: '01011111111',
    }) as SupplierTestRow

    const result = deleteSupplier(supplier.id)

    expect(result.ok).toBe(true)

    const deleted = getSupplierById(supplier.id) as SupplierTestRow
    expect(deleted.is_active).toBe(0)

    const suppliers = getSuppliers() as SupplierTestRow[]
    expect(suppliers.some((item) => item.id === supplier.id)).toBe(false)
  })

  it('rejects deleting a supplier with outstanding balance', () => {
    const supplier = createSupplier({
      name: 'Supplier With Balance',
      phone: '01033334444',
    }) as SupplierTestRow

    getDb()
      .prepare(
        `
      UPDATE suppliers
      SET balance = ?
      WHERE id = ?
      `,
      )
      .run(500, supplier.id)

    expect(() => deleteSupplier(supplier.id)).toThrow(
      'لا يمكن حذف المورد لأن له مستحقات',
    )

    const afterDelete = getSupplierById(supplier.id) as SupplierTestRow

    expect(afterDelete.is_active).toBe(1)
  })

  it('does not return inactive suppliers in search', () => {
    const supplier = createSupplier({
      name: 'Inactive Search Supplier',
      phone: '01022222222',
    }) as SupplierTestRow

    deleteSupplier(supplier.id)

    const results = getSuppliers('Inactive Search') as SupplierTestRow[]

    expect(results).toHaveLength(0)
  })

  it('paginates suppliers without hiding old records', () => {
    for (let index = 1; index <= 5; index += 1) {
      createSupplier({
        name: `Paged Supplier ${index}`,
        phone: `0118000000${index}`,
      })
    }

    const firstPage = listSuppliers({
      limit: 2,
      offset: 0,
    })

    const secondPage = listSuppliers({
      limit: 2,
      offset: 2,
    })

    expect(firstPage.total).toBe(5)
    expect(firstPage.rows).toHaveLength(2)
    expect(secondPage.rows).toHaveLength(2)
  })

  it('summarizes supplier debt into aging buckets', () => {
    const db = getDb()

    const supplier = createSupplier({
      name: 'Aging Supplier',

      phone: '01055550001',
    }) as SupplierTestRow

    const insertPurchase = db.prepare(
      `
        INSERT INTO purchase_invoices (
          supplier_id,

          total_amount,

          remaining_amount,

          payment_status,

          business_date
        )

        VALUES (
          ?,
          ?,
          ?,
          'unpaid',
          date(
            'now',
            'localtime',
            ?
          )
        )
        `,
    )

    insertPurchase.run(supplier.id, 100, 100, '-10 days')

    insertPurchase.run(supplier.id, 200, 200, '-40 days')

    insertPurchase.run(supplier.id, 300, 300, '-70 days')

    insertPurchase.run(supplier.id, 400, 400, '-100 days')

    expect(getSupplierAgingSummary(supplier.id)).toEqual({
      days_0_30: 100,

      days_31_60: 200,

      days_61_90: 300,

      days_90_plus: 400,

      total: 1000,
    })

    const page = listSuppliers({
      include_summary: true,

      limit: 20,

      offset: 0,
    })

    expect(page.summary?.aging).toEqual({
      days_0_30: 100,

      days_31_60: 200,

      days_61_90: 300,

      days_90_plus: 400,

      total: 1000,
    })

    const otherSupplier = createSupplier({
      name: 'Other Supplier',

      phone: '01055550002',
    }) as SupplierTestRow

    insertPurchase.run(otherSupplier.id, 900, 900, '-10 days')

    const filteredPage = listSuppliers({
      search: 'Aging Supplier',

      include_summary: true,

      limit: 20,

      offset: 0,
    })

    expect(filteredPage.rows).toHaveLength(1)

    expect(filteredPage.summary?.aging).toEqual({
      days_0_30: 100,

      days_31_60: 200,

      days_61_90: 300,

      days_90_plus: 400,

      total: 1000,
    })

    const allSuppliersPage = listSuppliers({
      include_summary: true,

      limit: 20,

      offset: 0,
    })

    expect(allSuppliersPage.summary?.aging?.total).toBe(1900)
  })

  it('summarizes supplier debt by due date', () => {
    const db = getDb()

    const supplier = createSupplier({
      name: 'Due Supplier',

      phone: '01066660002',
    }) as SupplierTestRow

    const insertPurchase = db.prepare(
      `
        INSERT INTO purchase_invoices (
          supplier_id,
          total_amount,
          remaining_amount,
          payment_status,
          business_date,
          due_date
        )

        VALUES (
          ?,
          ?,
          ?,
          'unpaid',
          date(
            'now',
            'localtime'
          ),
          ?
        )
        `,
    )

    const dueDate = (modifier: string | null) => {
      if (!modifier) {
        return null
      }

      const row = db
        .prepare(
          `
          SELECT
            date(
              'now',
              'localtime',
              ?
            ) AS value
          `,
        )
        .get(modifier) as {
        value: string
      }

      return row.value
    }

    insertPurchase.run(supplier.id, 100, 100, dueDate('-1 day'))

    insertPurchase.run(supplier.id, 200, 200, dueDate('+0 days'))

    insertPurchase.run(supplier.id, 300, 300, dueDate('+5 days'))

    insertPurchase.run(supplier.id, 400, 400, dueDate('+15 days'))

    insertPurchase.run(supplier.id, 500, 500, null)

    const page = listSuppliers({
      search: 'Due Supplier',

      include_summary: true,

      limit: 20,

      offset: 0,
    })

    expect(page.summary?.due).toEqual({
      overdue: 100,

      due_today: 200,

      due_soon: 300,

      without_due_date: 500,

      total_open: 1500,
    })
  })
})
