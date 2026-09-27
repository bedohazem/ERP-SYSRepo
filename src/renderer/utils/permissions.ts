import {
  getRoleDefaultPermissions,
  type PermissionKey,
} from '../../shared/permissions'

export type PermissionUser =
  | {
      role?: string | null

      permissions?: PermissionKey[] | null
    }
  | null
  | undefined

export function hasUserPermission(
  user: PermissionUser,
  permission: PermissionKey,
) {
  if (user?.role === 'admin') {
    return true
  }

  const permissions = Array.isArray(user?.permissions)
    ? user.permissions
    : getRoleDefaultPermissions(user?.role || 'cashier')

  return permissions.includes(permission)
}
