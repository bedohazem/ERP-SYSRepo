export const SESSION_IDLE_MINUTES_OPTIONS = [
  5, 10, 15, 30, 60, 120, 240, 480,
] as const;

export type SessionIdleMinutes = (typeof SESSION_IDLE_MINUTES_OPTIONS)[number];

export type SessionSettings = {
  auto_lock_enabled: boolean;
  idle_minutes: SessionIdleMinutes;
};

export const DEFAULT_SESSION_SETTINGS: SessionSettings = {
  auto_lock_enabled: true,
  idle_minutes: 15,
};

export function isSessionIdleMinutes(
  value: unknown,
): value is SessionIdleMinutes {
  return (
    typeof value === 'number' &&
    SESSION_IDLE_MINUTES_OPTIONS.some((option) => option === value)
  );
}
