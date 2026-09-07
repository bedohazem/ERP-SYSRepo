export function getActiveSaleReturnHistory(history: unknown): any[] {
  if (!Array.isArray(history)) {
    return []
  }

  return history.filter((item: any) => !item?.cancelled_at)
}
