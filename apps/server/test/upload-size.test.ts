import { afterEach, expect, it } from 'vitest';
import { ClamdScanner } from '../src/lib/clamav.js';
import { files, startFakeClamd } from './fakes.js';
import { loggedIn, setup, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let stop: () => void = () => {};
afterEach(async () => {
  await ctx.close();
  stop();
});

it('accepts files well above the JSON body limit but within MAX_UPLOAD_MB', async () => {
  const clamd = await startFakeClamd();
  stop = () => clamd.server.close();
  ctx = await setup({}, { scanner: new ClamdScanner({ host: '127.0.0.1', port: clamd.port, timeoutMs: 5000 }) });
  const { client } = await loggedIn(ctx, 'm@x.org', 'manager');
  const board = (await client.post('/api/boards', { name: 'b', templateKey: 'blank' })).json().board;
  const item = (await client.post(`/api/boards/${board.id}/items`, { groupId: board.groups[0].id, name: 'i' })).json().item;
  const data = Buffer.concat([files.png, Buffer.alloc(6 * 1024 * 1024, 7)]);
  const res = await client.upload(`/api/items/${item.id}/attachments`, 'big.png', data);
  expect(res.statusCode, res.body).toBe(201);
  expect(res.json().attachment.size).toBe(data.length);
  expect(clamd.scans[0]).toBe(data.length);
});
