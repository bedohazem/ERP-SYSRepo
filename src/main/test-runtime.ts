export function isTestAdminSeedAllowed(
  isPackaged: boolean,
  env: NodeJS.ProcessEnv = process.env,
) {
  if (isPackaged) {
    return false;
  }

  return env.VITEST === 'true' || env.NODE_ENV === 'test';
}

export function isE2eSmokeAllowed(
  isPackaged: boolean,
  env: NodeJS.ProcessEnv = process.env,
) {
  return !isPackaged && env.ERP_E2E_SMOKE === '1';
}
