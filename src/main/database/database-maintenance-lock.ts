let maintenanceTail: Promise<void> = Promise.resolve();

export async function runDatabaseMaintenanceExclusive<T>(
  work: () => Promise<T>,
): Promise<T> {
  const previous = maintenanceTail;

  let release!: () => void;

  maintenanceTail = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;

  try {
    return await work();
  } finally {
    release();
  }
}
