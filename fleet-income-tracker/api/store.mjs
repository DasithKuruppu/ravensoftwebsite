/**
 * Storage layer — single DynamoDB table, single-table design.
 *
 *   Daily entry : pk = "DRIVER#<id>"  sk = "ENTRY#<yyyy-mm-dd>"
 *   Settings    : pk = "DRIVER#<id>"  sk = "SETTINGS"
 *
 * A month is one Query with begins_with(sk, "ENTRY#yyyy-mm"). Adding a second
 * driver later is just another DRIVER#<id> partition — every function here
 * already takes a driverId.
 *
 * STORE=memory swaps in a JSON-file store for local development, because
 * DynamoDB Local needs Docker/Java that not every machine has. The interface
 * is identical, so the same handler code runs against both and against the
 * real table in production.
 */
import { DEFAULT_SETTINGS } from '../shared/commission.mjs';
import { DEFAULT_CHARGERS } from '../shared/chargers.mjs';

const TABLE = process.env.TABLE_NAME || 'fleet-tracker';
const MODE = process.env.STORE || (process.env.DDB_ENDPOINT ? 'ddb' : 'memory');

export const DEFAULT_DRIVER = 'default';
const pk = (driverId) => `DRIVER#${driverId}`;
const entrySk = (date) => `ENTRY#${date}`;
const SETTINGS_SK = 'SETTINGS';
// Charging stations are fleet-wide, not per-driver, so they sit in their own
// partition rather than under DRIVER#<id>.
const CONFIG_PK = 'CONFIG';
const CHARGERS_SK = 'CHARGERS';
// Previous GPS fix, kept so speed can be derived across Lambda cold starts.
const LASTFIX_SK = 'LASTFIX';

/* ────────────────────────────── DynamoDB ────────────────────────────── */

let docClient;
async function ddb() {
  if (!docClient) {
    const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
    const { DynamoDBDocumentClient } = await import('@aws-sdk/lib-dynamodb');
    const client = new DynamoDBClient({
      region: process.env.AWS_REGION || 'us-east-1',
      // Set DDB_ENDPOINT=http://localhost:8000 to hit DynamoDB Local.
      ...(process.env.DDB_ENDPOINT
        ? {
            endpoint: process.env.DDB_ENDPOINT,
            credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
          }
        : {}),
    });
    docClient = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }
  return docClient;
}

const ddbImpl = {
  async queryMonth(driverId, month) {
    const { QueryCommand } = await import('@aws-sdk/lib-dynamodb');
    const client = await ddb();
    const items = [];
    let ExclusiveStartKey;
    do {
      const res = await client.send(
        new QueryCommand({
          TableName: TABLE,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
          ExpressionAttributeValues: { ':pk': pk(driverId), ':sk': `ENTRY#${month}` },
          ExclusiveStartKey,
        }),
      );
      items.push(...(res.Items || []));
      ExclusiveStartKey = res.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return items.map(toEntry);
  },

  async getEntry(driverId, date) {
    const { GetCommand } = await import('@aws-sdk/lib-dynamodb');
    const client = await ddb();
    const res = await client.send(
      new GetCommand({ TableName: TABLE, Key: { pk: pk(driverId), sk: entrySk(date) } }),
    );
    return res.Item ? toEntry(res.Item) : null;
  },

  async putEntry(driverId, entry) {
    const { PutCommand } = await import('@aws-sdk/lib-dynamodb');
    const client = await ddb();
    const item = { pk: pk(driverId), sk: entrySk(entry.date), ...entry, updatedAt: new Date().toISOString() };
    await client.send(new PutCommand({ TableName: TABLE, Item: item }));
    return toEntry(item);
  },

  async deleteEntry(driverId, date) {
    const { DeleteCommand } = await import('@aws-sdk/lib-dynamodb');
    const client = await ddb();
    await client.send(
      new DeleteCommand({ TableName: TABLE, Key: { pk: pk(driverId), sk: entrySk(date) } }),
    );
  },

  async getSettings(driverId) {
    const { GetCommand } = await import('@aws-sdk/lib-dynamodb');
    const client = await ddb();
    const res = await client.send(
      new GetCommand({ TableName: TABLE, Key: { pk: pk(driverId), sk: SETTINGS_SK } }),
    );
    return res.Item ? stripKeys(res.Item) : { ...DEFAULT_SETTINGS, csvMapping: null };
  },

  async putSettings(driverId, settings) {
    const { PutCommand } = await import('@aws-sdk/lib-dynamodb');
    const client = await ddb();
    const item = { pk: pk(driverId), sk: SETTINGS_SK, ...settings, updatedAt: new Date().toISOString() };
    await client.send(new PutCommand({ TableName: TABLE, Item: item }));
    return stripKeys(item);
  },

  async getChargers() {
    const { GetCommand } = await import('@aws-sdk/lib-dynamodb');
    const client = await ddb();
    const res = await client.send(
      new GetCommand({ TableName: TABLE, Key: { pk: CONFIG_PK, sk: CHARGERS_SK } }),
    );
    // Nothing saved yet: fall back to the seed list shipped with the code.
    return res.Item?.list?.length ? res.Item.list : DEFAULT_CHARGERS;
  },

  async putChargers(list) {
    const { PutCommand } = await import('@aws-sdk/lib-dynamodb');
    const client = await ddb();
    await client.send(
      new PutCommand({
        TableName: TABLE,
        Item: { pk: CONFIG_PK, sk: CHARGERS_SK, list, updatedAt: new Date().toISOString() },
      }),
    );
    return list;
  },

  async getLastFix() {
    const { GetCommand } = await import('@aws-sdk/lib-dynamodb');
    const client = await ddb();
    const res = await client.send(
      new GetCommand({ TableName: TABLE, Key: { pk: CONFIG_PK, sk: LASTFIX_SK } }),
    );
    return res.Item?.fix || null;
  },

  async putLastFix(fix) {
    const { PutCommand } = await import('@aws-sdk/lib-dynamodb');
    const client = await ddb();
    await client.send(
      new PutCommand({ TableName: TABLE, Item: { pk: CONFIG_PK, sk: LASTFIX_SK, fix } }),
    );
    return fix;
  },
};

/* ─────────────────────── Local JSON-file fallback ─────────────────────── */

import fs from 'node:fs';
import path from 'node:path';

// Resolved lazily from cwd rather than import.meta.url so this module survives
// being bundled to CJS for Lambda (where this store is never used anyway).
function dataFile() {
  return process.env.LOCAL_STORE_FILE || path.join(process.cwd(), '.local', 'store.json');
}

function readAll() {
  try {
    return JSON.parse(fs.readFileSync(dataFile(), 'utf8'));
  } catch {
    return {};
  }
}

function writeAll(db) {
  const file = dataFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(db, null, 2));
}

const memImpl = {
  async queryMonth(driverId, month) {
    const db = readAll();
    const part = db[pk(driverId)] || {};
    return Object.entries(part)
      .filter(([sk]) => sk.startsWith(`ENTRY#${month}`))
      .map(([, v]) => toEntry(v))
      .sort((a, b) => a.date.localeCompare(b.date));
  },
  async getEntry(driverId, date) {
    const db = readAll();
    const item = (db[pk(driverId)] || {})[entrySk(date)];
    return item ? toEntry(item) : null;
  },
  async putEntry(driverId, entry) {
    const db = readAll();
    db[pk(driverId)] = db[pk(driverId)] || {};
    const item = { ...entry, updatedAt: new Date().toISOString() };
    db[pk(driverId)][entrySk(entry.date)] = item;
    writeAll(db);
    return toEntry(item);
  },
  async deleteEntry(driverId, date) {
    const db = readAll();
    if (db[pk(driverId)]) delete db[pk(driverId)][entrySk(date)];
    writeAll(db);
  },
  async getSettings(driverId) {
    const db = readAll();
    const item = (db[pk(driverId)] || {})[SETTINGS_SK];
    return item ? stripKeys(item) : { ...DEFAULT_SETTINGS, csvMapping: null };
  },
  async putSettings(driverId, settings) {
    const db = readAll();
    db[pk(driverId)] = db[pk(driverId)] || {};
    const item = { ...settings, updatedAt: new Date().toISOString() };
    db[pk(driverId)][SETTINGS_SK] = item;
    writeAll(db);
    return stripKeys(item);
  },
  async getChargers() {
    const db = readAll();
    const item = (db[CONFIG_PK] || {})[CHARGERS_SK];
    return item?.list?.length ? item.list : DEFAULT_CHARGERS;
  },
  async putChargers(list) {
    const db = readAll();
    db[CONFIG_PK] = db[CONFIG_PK] || {};
    db[CONFIG_PK][CHARGERS_SK] = { list, updatedAt: new Date().toISOString() };
    writeAll(db);
    return list;
  },
  async getLastFix() {
    const db = readAll();
    return (db[CONFIG_PK] || {})[LASTFIX_SK]?.fix || null;
  },
  async putLastFix(fix) {
    const db = readAll();
    db[CONFIG_PK] = db[CONFIG_PK] || {};
    db[CONFIG_PK][LASTFIX_SK] = { fix };
    writeAll(db);
    return fix;
  },
};

/* ───────────────────────────── helpers ───────────────────────────── */

function stripKeys({ pk: _p, sk: _s, ...rest }) {
  return rest;
}

function toEntry(item) {
  const { pk: _p, sk, ...rest } = item;
  return {
    date: rest.date || (sk ? sk.replace('ENTRY#', '') : undefined),
    revenue: num(rest.revenue),
    trips: rest.trips === undefined || rest.trips === null ? null : num(rest.trips),
    uberKm: rest.uberKm === undefined || rest.uberKm === null ? null : num(rest.uberKm),
    gpsKm: rest.gpsKm === undefined || rest.gpsKm === null ? null : num(rest.gpsKm),
    // Cash the driver took directly from riders. The rest of `revenue` reaches
    // the company by bank, so this is the amount he owes the owner.
    cashCollected:
      rest.cashCollected === undefined || rest.cashCollected === null
        ? null
        : num(rest.cashCollected),
    source: rest.source || 'manual',
    // A day the driver was not working. Kept separate from "no entry", which
    // only means nobody has recorded anything yet.
    offDay: rest.offDay === true,
    updatedAt: rest.updatedAt,
  };
}

function num(v) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

export const store = MODE === 'ddb' ? ddbImpl : memImpl;
export const storeMode = MODE;
