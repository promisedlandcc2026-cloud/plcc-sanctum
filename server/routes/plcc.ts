import type { Request, Response } from 'express';
import { RoomNotFound, SessionNotJoinable, Unauthorized } from '../../shared/errors.ts';
import { isJoinableSessionStatus } from '../../shared/sessionStateMachine.ts';
import { BROADCAST_PREFIX, BROADCAST_MAX } from '../../shared/broadcast.ts';
import { requireOrganization } from '../cms/access.ts';
import { resolveActorFromRequest } from '../clerkAuth.ts';
import { requireCanManageParticipants } from '../authz.ts';
import { sendError } from '../http.ts';
import { getPrisma } from '../prisma.ts';
import { DatabaseUnavailable } from '../../shared/errors.ts';
import { getBridgeStatus, listBridges, startJordanBridge, stopJordanBridge, type BridgeStatus } from '../bridge/jordanBridge.ts';
import { broadcastSessionEvent } from '../realtime/ensureLiveKitRoom.ts';
import {
  chatMessageRepository,
  prayerRoomRepository,
  sessionRepository,
  userRepository,
} from '../repositories/index.ts';

function canaanOrigin() {
  return String(process.env.PLCC_API_ORIGIN || 'https://plcc-opal.vercel.app').replace(/\/+$/, '');
}

export interface JordanRoomCount {
  id: string;
  name: string;
  live: boolean;
  count: number | null;
  capacity: number | null;
}

/**
 * GET /api/plcc/jordan-rooms — church staff only.
 * Jordan's open prayer rooms with how many people are in each right now. Counts come
 * from PLCC Canaan, which only gives them to this server (SANCTUM_SERVICE_KEY). The key
 * never reaches a browser. Without the key, rooms come back with count: null.
 */
export async function jordanRoomsHandler(req: Request, res: Response): Promise<void> {
  try {
    const actor = await resolveActorFromRequest(req);
    requireOrganization(actor);
    res.setHeader('Cache-Control', 'private, no-store');

    const key = String(process.env.SANCTUM_SERVICE_KEY || '').trim();
    let rooms: JordanRoomCount[] = [];
    let counts = false;
    try {
      const response = await fetch(`${canaanOrigin()}/api/vault?resource=live-prayer&rooms=1`, {
        headers: key ? { 'x-sanctum-key': key } : {},
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) {
        const data = (await response.json()) as { rooms?: unknown };
        const list = Array.isArray(data.rooms) ? data.rooms : [];
        rooms = list
          .filter((r: any) => r && typeof r.id === 'string' && typeof r.name === 'string')
          .map((r: any) => {
            const hasCount = typeof r.count === 'number';
            if (hasCount) counts = true;
            return {
              id: r.id,
              name: r.name,
              live: r.live === true,
              count: hasCount ? Math.max(0, Math.round(r.count)) : null,
              capacity: typeof r.capacity === 'number' ? r.capacity : null,
            };
          });
      }
    } catch {
      /* Canaan unreachable: answer with no rooms rather than an error. */
    }
    res.json({ rooms, counts, keyConfigured: Boolean(key) });
  } catch (error) {
    sendError(res, error);
  }
}

/**
 * POST /api/sessions/:id/broadcast — moderators only (can manage participants).
 * Sends one announcement to everyone in a live Sanctum prayer room: it appears as a
 * banner in the room and is kept in the room's chat so late joiners see it too.
 */
export async function broadcastHandler(req: Request, res: Response): Promise<void> {
  try {
    const session = await sessionRepository.requireById(req.params.id);
    if (!isJoinableSessionStatus(session.status)) throw SessionNotJoinable(session.status);
    const room = await prayerRoomRepository.findById(session.prayerRoomId);
    if (!room) throw RoomNotFound(session.prayerRoomId);
    const actor = await resolveActorFromRequest(req, room.organizationId);
    requireCanManageParticipants(actor);

    const body = typeof req.body?.message === 'string' ? req.body.message.trim().slice(0, BROADCAST_MAX) : '';
    if (!body) throw Unauthorized('Write a message to send.');

    const name = (actor.userId ? await userRepository.findNameById(actor.userId) : null)?.trim() || 'Moderator';
    const displayName = `${BROADCAST_PREFIX}${name}`.slice(0, 80);
    const message = await chatMessageRepository.create({ sessionId: session.id, displayName, body });
    const timestamp = message.createdAt.toISOString();

    await broadcastSessionEvent(session.livekitRoomName, 'BROADCAST_MESSAGE', {
      sessionId: session.id,
      displayName: name,
      timestamp,
      metadata: { body, messageId: message.id },
    });
    // Also show it in the room chat for people who have the chat open.
    await broadcastSessionEvent(session.livekitRoomName, 'CHAT_MESSAGE', {
      sessionId: session.id,
      displayName,
      timestamp,
      metadata: { body, messageId: message.id },
    });

    res.status(201).json({ sent: true, roomName: room.name, timestamp });
  } catch (error) {
    sendError(res, error);
  }
}

/**
 * GET /api/audit — moderators only. The organization's latest audit events (who did
 * what, in which prayer room), newest first. Read only.
 */
export async function auditListHandler(req: Request, res: Response): Promise<void> {
  try {
    const actor = await resolveActorFromRequest(req);
    requireOrganization(actor);
    requireCanManageParticipants(actor);
    const prisma = getPrisma();
    if (!prisma) throw DatabaseUnavailable();
    const take = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
    const rows = await prisma.auditEvent.findMany({
      where: { organizationId: actor.organizationId },
      orderBy: { createdAt: 'desc' },
      take,
      include: {
        actor: { select: { name: true } },
        session: { select: { prayerRoom: { select: { name: true } } } },
      },
    });
    // Participant names for targets that are participants (removed, invited to speak…).
    const targetIds = [...new Set(rows.map((r) => r.targetId).filter(Boolean))] as string[];
    const participants = targetIds.length
      ? await prisma.sessionParticipant.findMany({
          where: { id: { in: targetIds } },
          select: { id: true, guestName: true, user: { select: { name: true } } },
        })
      : [];
    const rooms = targetIds.length
      ? await prisma.prayerRoom.findMany({ where: { id: { in: targetIds } }, select: { id: true, name: true } })
      : [];
    const names = new Map<string, string>([
      ...participants.map((p) => [p.id, p.user?.name || p.guestName || 'A participant'] as [string, string]),
      ...rooms.map((r) => [r.id, r.name] as [string, string]),
    ]);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({
      events: rows.map((r) => ({
        id: r.id,
        action: r.action,
        actorName: r.actor?.name || null,
        roomName: r.session?.prayerRoom?.name || null,
        targetName: r.targetId ? names.get(r.targetId) || null : null,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    sendError(res, error);
  }
}

function publicBridge(status: BridgeStatus | null) {
  if (!status || status.state === 'stopped') return { active: false };
  return {
    active: status.state === 'live' || status.state === 'waiting' || status.state === 'starting',
    state: status.state,
    jordanRoomTitle: status.jordanRoomTitle,
    jordanChannelId: status.jordanChannelId,
    speakers: status.speakers,
    startedAt: status.startedAt,
    error: status.error || null,
  };
}

/** GET /api/sessions/:id/bridge — public: is this overflow room hearing Jordan right now? */
export async function bridgeStatusHandler(req: Request, res: Response): Promise<void> {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ bridge: publicBridge(getBridgeStatus(String(req.params.id))) });
  } catch (error) {
    sendError(res, error);
  }
}

/**
 * POST /api/sessions/:id/bridge { jordanChannelId, jordanRoomTitle } — moderators: relay a
 * Jordan prayer room's audio into this live overflow room. DELETE stops it.
 */
export async function bridgeStartHandler(req: Request, res: Response): Promise<void> {
  try {
    const session = await sessionRepository.requireById(req.params.id);
    if (!isJoinableSessionStatus(session.status)) throw SessionNotJoinable(session.status);
    const room = await prayerRoomRepository.findById(session.prayerRoomId);
    if (!room) throw RoomNotFound(session.prayerRoomId);
    const actor = await resolveActorFromRequest(req, room.organizationId);
    requireCanManageParticipants(actor);
    if (!session.livekitRoomName) throw Unauthorized('Start the overflow session first.');
    const channelId = typeof req.body?.jordanChannelId === 'string' ? req.body.jordanChannelId.trim() : '';
    const title = typeof req.body?.jordanRoomTitle === 'string' ? req.body.jordanRoomTitle.trim() : '';
    const startedBy = actor.userId ? await userRepository.findNameById(actor.userId) : null;
    const livekitRoomName = session.livekitRoomName;
    const notify = (status: BridgeStatus) => {
      void broadcastSessionEvent(livekitRoomName, 'BRIDGE_CHANGED', {
        sessionId: session.id,
        metadata: publicBridge(status),
      });
    };
    let status: BridgeStatus;
    try {
      status = await startJordanBridge({
        sessionId: session.id,
        sanctumRoomName: livekitRoomName,
        jordanChannelId: channelId,
        jordanRoomTitle: title,
        startedBy,
        onChange: notify,
      });
    } catch (err: any) {
      res.status(409).json({ error: 'BRIDGE_FAILED', message: String(err?.message || 'Could not start the bridge.') });
      return;
    }
    notify(status);
    res.status(201).json({ bridge: publicBridge(status) });
  } catch (error) {
    sendError(res, error);
  }
}

export async function bridgeStopHandler(req: Request, res: Response): Promise<void> {
  try {
    const session = await sessionRepository.requireById(req.params.id);
    const room = await prayerRoomRepository.findById(session.prayerRoomId);
    if (!room) throw RoomNotFound(session.prayerRoomId);
    const actor = await resolveActorFromRequest(req, room.organizationId);
    requireCanManageParticipants(actor);
    await stopJordanBridge(session.id);
    await broadcastSessionEvent(session.livekitRoomName, 'BRIDGE_CHANGED', { sessionId: session.id, metadata: { active: false } });
    res.json({ bridge: { active: false } });
  } catch (error) {
    sendError(res, error);
  }
}

/**
 * GET /api/overflow?jordanChannelId=… — public, read by PLCC Jordan when a prayer room is
 * full. Answers with the Sanctum overflow room to send members to: first a room that is
 * relaying that Jordan room's audio, otherwise any live overflow room. No people or counts.
 */
export async function overflowForJordanHandler(req: Request, res: Response): Promise<void> {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  try {
    const channelId = typeof req.query.jordanChannelId === 'string' ? req.query.jordanChannelId.trim() : '';
    const prisma = getPrisma();
    if (!prisma) {
      res.json({ available: false });
      return;
    }
    const bridged = new Map(
      listBridges()
        .filter((b) => b.state === 'live' || b.state === 'waiting' || b.state === 'starting')
        .map((b) => [b.sessionId, b] as const)
    );
    const sessions = await prisma.prayerSession.findMany({
      where: { status: { in: ['LIVE', 'WAITING', 'STARTING'] } },
      include: { prayerRoom: { select: { name: true, slug: true, status: true, kind: true, passcodeHash: true, allowGuests: true } } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    // Only open, public prayer rooms: members arriving from Jordan aren't signed in to Sanctum.
    const usable = sessions.filter(
      (s) =>
        s.prayerRoom &&
        s.prayerRoom.status !== 'ARCHIVED' &&
        s.prayerRoom.kind === 'CORPORATE' &&
        !s.prayerRoom.passcodeHash &&
        s.prayerRoom.allowGuests
    );
    const pick =
      usable.find((s) => channelId && bridged.get(s.id)?.jordanChannelId === channelId) ||
      usable.find((s) => s.status === 'LIVE' && bridged.has(s.id)) ||
      usable.find((s) => s.status === 'LIVE') ||
      usable[0];
    if (!pick) {
      res.json({ available: false });
      return;
    }
    const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
    const origin = `${proto}://${req.get('host')}`;
    const bridge = bridged.get(pick.id);
    res.json({
      available: true,
      roomName: pick.prayerRoom.name,
      joinUrl: `${origin}/join/${encodeURIComponent(pick.prayerRoom.slug)}?from=jordan`,
      status: pick.status,
      hearsJordan: Boolean(bridge && (!channelId || bridge.jordanChannelId === channelId)),
    });
  } catch {
    res.json({ available: false });
  }
}
