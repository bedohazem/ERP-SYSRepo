import { beforeEach, describe, expect, it } from 'vitest'

import { closeDb, getDb, resetDatabaseData } from '../../src/main/database/db'

import {
  createUser,
  findUserByUsername,
} from '../../src/main/database/repositories/user.repo'

import {
  createActivityLog,
  listActivityLogs,
} from '../../src/main/database/repositories/activity.repo'

import {
  requireAdminApproval,
  requireAdminPassword,
} from '../../src/main/ipc/permission-helper'

describe('admin approval identity', () => {
  beforeEach(() => {
    closeDb()

    getDb()

    resetDatabaseData()
  })

  it('returns exact approving admin identity', () => {
    const manager = createUser(
      'Manager Two',
      'manager_two',
      'Manager234',
      'admin',
    )

    const approval = requireAdminApproval('manager_two', 'Manager234')

    expect(approval.id).toBe(manager.id)

    expect(approval.username).toBe('manager_two')

    expect(approval.name).toBe('Manager Two')
  })

  it('rejects wrong approval credentials without revealing username existence', () => {
    createUser('Manager Two', 'manager_two', 'Manager234', 'admin')

    expect(() => requireAdminApproval('manager_two', 'Wrong234')).toThrow(
      'بيانات اعتماد المدير غير صحيحة',
    )

    expect(() => requireAdminApproval('missing_admin', 'Manager234')).toThrow(
      'بيانات اعتماد المدير غير صحيحة',
    )
  })

  it('returns current admin identity when confirming own password', () => {
    const admin = findUserByUsername('admin')!

    const approval = requireAdminPassword(
      admin.id,

      process.env.ERP_TEST_ADMIN_PASSWORD || 'Admin1234',
    )

    expect(approval.id).toBe(admin.id)

    expect(approval.username).toBe(admin.username)
  })

  it('stores approving admin identity in activity log', () => {
    const actor = findUserByUsername('admin')!

    const approver = createUser(
      'Approving Manager',
      'approving_manager',
      'Approve234',
      'admin',
    )

    createActivityLog({
      user_id: actor.id,

      approved_by: approver.id,

      action: 'test_sensitive_action',

      entity: 'tests',

      entity_id: 77,

      details: JSON.stringify({
        ok: true,
      }),
    })

    const result = listActivityLogs({
      search: 'Approving Manager',
    })

    expect(result.rows.length).toBeGreaterThan(0)

    const row = result.rows[0] as any

    expect(Number(row.approved_by)).toBe(approver.id)

    expect(row.approved_by_name).toBe('Approving Manager')

    expect(row.approved_by_username).toBe('approving_manager')
  })
})
