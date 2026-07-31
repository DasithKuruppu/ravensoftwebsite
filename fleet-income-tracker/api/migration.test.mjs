/**
 * What deploying this version does to data the previous one wrote.
 *
 * Two fields were added — `paidByDriverCash` on a cost, `cashFloats` on the
 * settings — and neither may disturb a record that predates them. There is no
 * migration step and nothing writes on boot: a deploy replaces Lambda code and
 * touches no rows, so the only risk is a read or a save round-trip quietly
 * dropping a value. That is what this pins.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import bcrypt from 'bcryptjs';
process.env.LOCAL_STORE_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(),'fleet-safety-')),'store.json');
process.env.JWT_SECRET='t'; process.env.OWNER_PASSWORD_HASH=bcrypt.hashSync('o',4); process.env.DRIVER_PASSWORD_HASH=bcrypt.hashSync('d',4);
let handler, store, DEFAULT_DRIVER, token;
beforeAll(async () => {
  ({ handler } = await import('./handler.mjs'));
  ({ store, DEFAULT_DRIVER } = await import('./store.mjs'));
  const r = await handler({version:'2.0',rawPath:'/login',requestContext:{http:{method:'POST',path:'/login'}},headers:{'content-type':'application/json'},body:JSON.stringify({username:'owner',password:'o'})});
  token = JSON.parse(r.body).token;
});
const call = (m,p,body) => handler({version:'2.0',rawPath:p.split('?')[0],rawQueryString:p.split('?')[1]||'',requestContext:{http:{method:m,path:p.split('?')[0]}},headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});

describe('deploying the new code over existing data', () => {
  it('leaves costs written by the OLD code untouched on read', async () => {
    // Exactly what the previous version stored: no paidByDriverCash field.
    await store.putCosts([
      { id:'lease', label:'Lease instalment', category:'lease', frequency:'monthly', amount:85000, date:'2026-01-01', termMonths:36 },
      { id:'insurance', label:'Insurance', category:'insurance', frequency:'annual', amount:120000, date:'2026-01-01' },
    ]);
    const res = await call('GET','/costs');
    const costs = JSON.parse(res.body).costs;
    expect(costs.find(c=>c.id==='lease').amount).toBe(85000);
    expect(costs.find(c=>c.id==='insurance').amount).toBe(120000);
  });

  it('keeps the amounts when the editor saves them back', async () => {
    const read = JSON.parse((await call('GET','/costs')).body).costs;
    const saved = JSON.parse((await call('PUT','/costs',{ costs: read })).body).costs;
    expect(saved.find(c=>c.id==='lease').amount).toBe(85000);
    expect(saved.find(c=>c.id==='lease').paidByDriverCash).toBe(false);
    expect(saved.find(c=>c.id==='lease').termMonths).toBe(36);
  });

  it('keeps settings that predate cashFloats', async () => {
    const before = JSON.parse((await call('GET','/settings')).body);
    const after = JSON.parse((await call('PUT','/settings', { ...before, driverName:'Chandima' })).body);
    expect(after.cashFloats).toEqual({});
    expect(after.driverName).toBe('Chandima');
  });

  it('reports no float and no cash expenses for a month that has neither', async () => {
    const cash = JSON.parse((await call('GET','/summary?month=2026-07')).body).cash;
    expect(cash.startingFloat).toBe(0);
    expect(cash.cashExpenses).toBe(0);
    expect(cash.holding).toBe(cash.collected - cash.confirmed);
  });
});
