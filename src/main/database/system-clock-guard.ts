import { getDb } from './db';

const MAX_RUNTIME_DRIFT_MS = 10 * 1000;

const MAX_BACKWARD_MS = 2 * 60 * 1000;

const MAX_REFERENCE_FORWARD_STEP_MS = 36 * 60 * 60 * 1000;
/*
 * المنطقة الزمنية الثابتة للمتجر.
 *
 * تغيير Time Zone في Windows
 * لا يغيّر تاريخ الشفت.
 */
export const BUSINESS_TIME_ZONE = 'Africa/Cairo';

let runtimeWallAnchorMs = Date.now();

let runtimeMonotonicAnchorNs = process.hrtime.bigint();

let suspendedAtWallMs: number | null = null;

let clockLockedMessage: string | null = null;

function isClockGuardBypassed() {
  return (
    process.env.VITEST === 'true' &&
    process.env.ERP_SYSTEM_CLOCK_TEST_BYPASS === '1'
  );
}

function elapsedRuntimeMs() {
  return Number(process.hrtime.bigint() - runtimeMonotonicAnchorNs) / 1_000_000;
}

function lockClock(message: string) {
  clockLockedMessage =
    String(message || '').trim() ||
    'تم إيقاف العمليات المالية بسبب مشكلة في ساعة الجهاز';
}

export function markSystemClockChangedByWindows() {
  if (isClockGuardBypassed()) {
    return;
  }

  lockClock(
    'تم اكتشاف تغيير في تاريخ أو وقت Windows أثناء تشغيل البرنامج. صحح الوقت ثم أعد تشغيل البرنامج.',
  );
}

function formatBusinessDate(epochMs: number) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TIME_ZONE,

    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(epochMs));

  const values = new Map(parts.map((part) => [part.type, part.value]));

  const result =
    `${values.get('year') || ''}-` +
    `${values.get('month') || ''}-` +
    `${values.get('day') || ''}`;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) {
    throw new Error('تعذر تحديد تاريخ الجهاز');
  }

  return result;
}

export function getLocalBusinessDate() {
  return formatBusinessDate(Date.now());
}

export function resetSystemClockRuntimeAnchor() {
  runtimeWallAnchorMs = Date.now();

  runtimeMonotonicAnchorNs = process.hrtime.bigint();
}

export function markSystemSuspended() {
  suspendedAtWallMs = Date.now();
}

export function handleSystemResume() {
  if (isClockGuardBypassed()) {
    suspendedAtWallMs = null;

    resetSystemClockRuntimeAnchor();

    return;
  }

  const now = Date.now();

  /*
   * حتى لو الساعة اتغيرت أثناء Sleep
   * للخلف، ما نخفيش التغيير بمجرد
   * إعادة ضبط الـAnchor.
   */
  if (suspendedAtWallMs !== null && now + MAX_BACKWARD_MS < suspendedAtWallMs) {
    lockClock(
      'تم اكتشاف رجوع ساعة الجهاز للخلف أثناء تعليق الجهاز. صحح وقت Windows ثم أعد تشغيل البرنامج.',
    );

    suspendedAtWallMs = null;

    return;
  }

  suspendedAtWallMs = null;

  resetSystemClockRuntimeAnchor();
}

function saveSystemClockReference(epochMs: number) {
  const db = getDb();

  db.prepare(
    `
    INSERT INTO app_settings (
      key,
      value
    )

    VALUES (
      'system_clock_last_seen_epoch_ms',
      ?
    )

    ON CONFLICT(key)
    DO UPDATE SET
      value = excluded.value
    `,
  ).run(String(epochMs));
}

export function confirmSystemClockReference() {
  if (isClockGuardBypassed()) {
    return;
  }

  saveSystemClockReference(Date.now());
}

export function assertRuntimeSystemClockStable() {
  if (isClockGuardBypassed()) {
    return;
  }

  if (clockLockedMessage) {
    throw new Error(clockLockedMessage);
  }

  const expectedWallMs = runtimeWallAnchorMs + elapsedRuntimeMs();

  const runtimeDriftMs = Date.now() - expectedWallMs;

  if (Math.abs(runtimeDriftMs) > MAX_RUNTIME_DRIFT_MS) {
    lockClock(
      'تم اكتشاف تغيير غير طبيعي في ساعة أو تاريخ الجهاز أثناء تشغيل البرنامج. صحح وقت Windows ثم أعد تشغيل البرنامج.',
    );

    throw new Error(clockLockedMessage!);
  }
}

export function assertSystemClockStable() {
  if (isClockGuardBypassed()) {
    return;
  }

  assertRuntimeSystemClockStable();

  const nowMs = Date.now();

  const db = getDb();

  const previous = db
    .prepare(
      `
      SELECT value

      FROM app_settings

      WHERE key =
        'system_clock_last_seen_epoch_ms'

      LIMIT 1
      `,
    )
    .get() as
    | {
        value: string;
      }
    | undefined;

  const previousMs = Number(previous?.value);

  /*
   * مفيش Reference لسه:
   *
   * ما نعتمدش وقت الجهاز تلقائيًا.
   * أول شفت ناجح هو اللي يثبت
   * أول Reference.
   */
  if (!Number.isFinite(previousMs)) {
    return;
  }

  if (nowMs + MAX_BACKWARD_MS < previousMs) {
    lockClock(
      'ساعة الجهاز أقدم من آخر وقت مسجل في النظام. صحح تاريخ ووقت Windows ثم أعد تشغيل البرنامج.',
    );

    throw new Error(clockLockedMessage!);
  }

  const forwardStepMs = nowMs - previousMs;

  /*
   * الحركة الطبيعية للأمام
   * نحدث معها الـReference.
   *
   * القفزة الكبيرة للأمام لا نعتمدها
   * هنا؛ فتح الشفت هو اللي سيطلب
   * تأكيد المدير أولًا.
   */
  if (forwardStepMs >= 0 && forwardStepMs <= MAX_REFERENCE_FORWARD_STEP_MS) {
    saveSystemClockReference(nowMs);
  }
}
