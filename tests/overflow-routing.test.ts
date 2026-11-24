import type { Request, Response } from 'express';
import { beforeEach, expect, it, vi } from 'vitest';
import { overflowForJordanHandler } from '../server/routes/plcc.ts';

const { listBridges, findMany } = vi.hoisted(() => ({
  listBridges: vi.fn(),
  findMany: vi.fn(),
}));
vi.mock('../server/prisma.ts', () => ({ getPrisma: () => ({ prayerSession: { findMany } }) }));
vi.mock('../server/bridge/jordanBridge.ts', () => ({ listBridges }));

beforeEach(() => {
  findMany.mockResolvedValue([
    { id: 'session-a', status: 'LIVE', prayerRoom: { slug: 'overflow-a', name: 'Overflow A', kind: 'CORPORATE', allowGuests: true } },
    { id: 'session-b', status: 'LIVE', prayerRoom: { slug: 'overflow-b', name: 'Overflow B', kind: 'CORPORATE', allowGuests: true } },
  ]);
  listBridges.mockReturnValue([
    { sessionId: 'session-a', jordanChannelId: 'channel-a', jordanRoomTitle: 'Morning Glory', state: 'live' },
    { sessionId: 'session-b', jordanChannelId: 'channel-b', jordanRoomTitle: 'Evening Prayer', state: 'live' },
  ]);
});

async function requestOverflow(channel: string) {
  const request = { method: 'GET', query: { jordanChannelId: channel }, headers: {}, protocol: 'https', get: () => 'overflow.example' };
  const json = vi.fn();
  await overflowForJordanHandler(request as unknown as Request, { setHeader: vi.fn(), json } as unknown as Response);
  return json.mock.calls[0][0];
}

it('links a full channel to its own overflow and preserves the channel for validation', async () => {
  expect(await requestOverflow('channel-a')).toMatchObject({
    available: true,
    roomName: 'Morning Glory',
    joinUrl: 'https://overflow.example/join/overflow-a?from=jordan&channel=channel-a',
    hearsJordan: true,
  });
});

it('never offers a different channel’s overflow when the requested bridge is unavailable', async () => {
  expect(await requestOverflow('another-channel')).toEqual({ available: false });
});
