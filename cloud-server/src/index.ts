import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { checkDatabaseConnection, pool, query } from './db.js';

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const PORT = Number(process.env.PORT || 4000);

function requireApiKey(req: express.Request, res: express.Response, next: express.NextFunction) {
  const expectedKey = String(process.env.CLOUD_API_KEY || '').trim();

  if (!expectedKey) {
    return next();
  }

  const authHeader = String(req.headers.authorization || '');
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length).trim()
    : '';

  if (token !== expectedKey) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized'
    });
  }

  next();
}

app.get('/api/sync/ping', requireApiKey, async (_req, res) => {
  try {
    const db = await checkDatabaseConnection();

    res.json({
      success: true,
      online: true,
      service: 'erp-cloud-server',
      database: true,
      time: db.now
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      online: false,
      database: false,
      message: error instanceof Error ? error.message : 'Database connection failed'
    });
  }
});

app.get('/health', async (_req, res) => {
  try {
    const db = await checkDatabaseConnection();

    res.json({
      success: true,
      service: 'erp-cloud-server',
      database: true,
      time: db.now
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      service: 'erp-cloud-server',
      database: false,
      message: error instanceof Error ? error.message : 'Database connection failed'
    });
  }
});

app.post('/api/sync/operations', requireApiKey, async (req, res) => {
  const body = req.body || {};

  const operationId = String(body.id || body.operation_id || '').trim();
  const deviceId = String(body.device_id || '').trim();
  const branchId = body.branch_id == null ? null : String(body.branch_id).trim();
  const type = String(body.type || '').trim();
  const entity = body.entity == null ? null : String(body.entity).trim();
  const entityId = body.entity_id == null ? null : String(body.entity_id).trim();
  const payload = body.payload ?? null;
  const clientCreatedAt = body.created_at || null;

  if (!operationId) {
    return res.status(400).json({
      success: false,
      message: 'operation_id is required'
    });
  }

  if (!deviceId) {
    return res.status(400).json({
      success: false,
      message: 'device_id is required'
    });
  }

  if (!type) {
    return res.status(400).json({
      success: false,
      message: 'type is required'
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await client.query(
      `
      INSERT INTO devices (id, branch_id, last_seen_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT(id) DO UPDATE SET
        branch_id = COALESCE(EXCLUDED.branch_id, devices.branch_id),
        last_seen_at = NOW()
      `,
      [deviceId, branchId]
    );

    const inserted = await client.query(
      `
      INSERT INTO sync_operations (
        id,
        device_id,
        branch_id,
        type,
        entity,
        entity_id,
        payload,
        status,
        client_created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 'received', $8)
      ON CONFLICT(id) DO NOTHING
      RETURNING id
      `,
      [
        operationId,
        deviceId,
        branchId,
        type,
        entity,
        entityId,
        JSON.stringify(payload),
        clientCreatedAt
      ]
    );

    if (inserted.rowCount === 0) {
      await client.query('COMMIT');

      return res.json({
        success: true,
        duplicate: true,
        operation_id: operationId,
        message: 'Operation already received before'
      });
    }

    await client.query('COMMIT');

    return res.json({
      success: true,
      duplicate: false,
      operation_id: operationId,
      message: 'Operation received'
    });
  } catch (error) {
    await client.query('ROLLBACK');

    return res.status(500).json({
      success: false,
      operation_id: operationId,
      message: error instanceof Error ? error.message : 'Failed to save operation'
    });
  } finally {
    client.release();
  }
});

app.listen(PORT, () => {
  console.log(`ERP cloud server running on port ${PORT}`);
});