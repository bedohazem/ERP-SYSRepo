import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { getDb } from './db';

const MAX_BACKUPS = 7;

function getBackupDir() {
  return path.join(app.getPath('documents'), 'ERP-Store-Backups');
}

function getTodayBackupName() {
  const now = new Date();

  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('-');

  return `erp-auto-backup-${date}.db`;
}

function cleanupOldBackups(backupDir: string) {
  const files = fs
    .readdirSync(backupDir)
    .filter((file) => file.startsWith('erp-auto-backup-') && file.endsWith('.db'))
    .map((file) => ({
      file,
      fullPath: path.join(backupDir, file),
      time: fs.statSync(path.join(backupDir, file)).mtime.getTime()
    }))
    .sort((a, b) => b.time - a.time);

  const oldFiles = files.slice(MAX_BACKUPS);

  for (const item of oldFiles) {
    fs.unlinkSync(item.fullPath);
  }
}

export async function createDailyAutoBackup() {
  try {
    const backupDir = getBackupDir();

    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const backupPath = path.join(backupDir, getTodayBackupName());

    if (fs.existsSync(backupPath)) {
      return {
        success: true,
        skipped: true,
        path: backupPath
      };
    }

    const db = getDb();

    await db.backup(backupPath);

    cleanupOldBackups(backupDir);

    return {
      success: true,
      skipped: false,
      path: backupPath
    };
  } catch (error) {
    console.error('Auto backup failed:', error);

    return {
      success: false,
      message: error instanceof Error ? error.message : 'Auto backup failed'
    };
  }
}