/**
 * Jordan → Sanctum audio bridge.
 *
 * One hidden, listen-only connection joins a PLCC Jordan Live Huddle room (it takes one
 * of Jordan's 50 seats), mixes everyone it hears into a single stream, and publishes that
 * stream into a live PLCC Sanctum overflow room as "Live from Jordan". Overflow listeners
 * then hear the same prayer as the main room.
 *
 * Jordan (PLCC Canaan) and Sanctum use the same LiveKit project (same LIVEKIT_URL), so
 * Sanctum mints the Jordan token itself with its own API key. Bridges live in memory on
 * this server (one Render instance); a restart stops them and moderators start them again.
 */
import { AccessToken } from 'livekit-server-sdk';
import { env, isLiveKitConfigured } from '../env.ts';

/** Same prefix PLCC Canaan uses for Jordan channel rooms (livekitVoice.VOICE_ROOM_PREFIX). */
export const JORDAN_ROOM_PREFIX = 'awc-channel-';
export const BRIDGE_IDENTITY_PREFIX = 'plcc-sanctum-bridge';
export const BRIDGE_PUBLISHER_PREFIX = 'jordan-bridge';

const SAMPLE_RATE = 48000;
const CHANNELS = 1;

export type BridgeState = 'starting' | 'live' | 'waiting' | 'stopped' | 'error';

export interface BridgeStatus {
  sessionId: string;
  jordanChannelId: string;
  jordanRoomName: string;
  jordanRoomTitle: string;
  state: BridgeState;
  speakers: number;
  startedAt: string;
  startedBy: string | null;
  error?: string;
}

/** True for LiveKit identities that belong to a bridge (left out of headcounts). */
export function isBridgeIdentity(identity: string | null | undefined): boolean {
  const id = String(identity || '');
  return id.startsWith(BRIDGE_IDENTITY_PREFIX) || id.startsWith(BRIDGE_PUBLISHER_PREFIX);
}

type RtcModule = typeof import('@livekit/rtc-node');

interface RunningBridge {
  status: BridgeStatus;
  jordan?: InstanceType<RtcModule['Room']>;
  sanctum?: InstanceType<RtcModule['Room']>;
  mixer?: InstanceType<RtcModule['AudioMixer']>;
  streams: Map<string, InstanceType<RtcModule['AudioStream']>>;
  stopping: boolean;
}

const bridges = new Map<string, RunningBridge>();
let rtcPromise: Promise<RtcModule> | null = null;

/** The native LiveKit SDK loads only when a bridge actually starts. */
function loadRtc(): Promise<RtcModule> {
  rtcPromise ??= import('@livekit/rtc-node');
  return rtcPromise;
}

async function mintToken(opts: {
  roomName: string;
  identity: string;
  name: string;
  publish: boolean;
  hidden: boolean;
}): Promise<string> {
  const token = new AccessToken(env.livekitApiKey!, env.livekitApiSecret!, {
    identity: opts.identity,
    name: opts.name,
    ttl: 60 * 60 * 8,
  });
  token.addGrant({
    roomJoin: true,
    room: opts.roomName,
    canSubscribe: !opts.publish,
    canPublish: opts.publish,
    canPublishData: false,
    hidden: opts.hidden,
  });
  return token.toJwt();
}

export function getBridgeStatus(sessionId: string): BridgeStatus | null {
  const bridge = bridges.get(sessionId);
  return bridge ? { ...bridge.status } : null;
}

export function listBridges(): BridgeStatus[] {
  return [...bridges.values()].map((b) => ({ ...b.status }));
}

export async function startJordanBridge(input: {
  sessionId: string;
  sanctumRoomName: string;
  jordanChannelId: string;
  jordanRoomTitle?: string;
  startedBy?: string | null;
  onChange?: (status: BridgeStatus) => void;
}): Promise<BridgeStatus> {
  if (!isLiveKitConfigured() || !env.livekitUrl) throw new Error('LiveKit is not configured on this server.');
  const channelId = String(input.jordanChannelId || '').trim();
  if (!/^[0-9a-f-]{8,64}$/i.test(channelId)) throw new Error('Choose a Jordan prayer room.');

  await stopJordanBridge(input.sessionId);

  const jordanRoomName = `${JORDAN_ROOM_PREFIX}${channelId}`;
  const bridge: RunningBridge = {
    status: {
      sessionId: input.sessionId,
      jordanChannelId: channelId,
      jordanRoomName,
      jordanRoomTitle: (input.jordanRoomTitle || 'Jordan prayer room').slice(0, 120),
      state: 'starting',
      speakers: 0,
      startedAt: new Date().toISOString(),
      startedBy: input.startedBy ?? null,
    },
    streams: new Map(),
    stopping: false,
  };
  bridges.set(input.sessionId, bridge);
  const changed = () => input.onChange?.({ ...bridge.status });

  try {
    const rtc = await loadRtc();
    const { Room, RoomEvent, AudioSource, AudioStream, AudioMixer, LocalAudioTrack, TrackKind, TrackPublishOptions, TrackSource } = rtc;

    // 1) Publisher in the Sanctum overflow room.
    const sanctum = new Room();
    bridge.sanctum = sanctum;
    const source = new AudioSource(SAMPLE_RATE, CHANNELS);
    const track = LocalAudioTrack.createAudioTrack('Live from Jordan', source);
    await sanctum.connect(
      env.livekitUrl,
      await mintToken({
        roomName: input.sanctumRoomName,
        identity: `${BRIDGE_PUBLISHER_PREFIX}-${input.sessionId}`.slice(0, 120),
        name: 'Live from Jordan',
        publish: true,
        hidden: false,
      }),
      { autoSubscribe: false, dynacast: false }
    );
    const publishOptions = new TrackPublishOptions();
    publishOptions.source = TrackSource.SOURCE_MICROPHONE;
    await sanctum.localParticipant!.publishTrack(track, publishOptions);

    // 2) Mixer: everyone speaking in Jordan becomes one stream.
    const mixer = new AudioMixer(SAMPLE_RATE, CHANNELS, { blocksize: SAMPLE_RATE / 100, streamTimeoutMs: 200 });
    bridge.mixer = mixer;
    void (async () => {
      try {
        for await (const frame of mixer) {
          if (bridge.stopping) break;
          await source.captureFrame(frame);
        }
      } catch (err) {
        if (!bridge.stopping) console.warn('[jordan-bridge] mixer stopped', (err as Error)?.message || err);
      }
    })();

    // 3) Hidden listener in the Jordan room.
    const jordan = new Room();
    bridge.jordan = jordan;
    const refreshState = () => {
      bridge.status.speakers = bridge.streams.size;
      bridge.status.state = bridge.streams.size > 0 ? 'live' : 'waiting';
      changed();
    };
    jordan.on(RoomEvent.TrackSubscribed, (remoteTrack, _publication, participant) => {
      if (remoteTrack.kind !== TrackKind.KIND_AUDIO || isBridgeIdentity(participant.identity)) return;
      const key = `${participant.identity}:${remoteTrack.sid}`;
      if (bridge.streams.has(key)) return;
      const stream = new AudioStream(remoteTrack, SAMPLE_RATE, CHANNELS);
      bridge.streams.set(key, stream);
      mixer.addStream(stream as any);
      refreshState();
    });
    jordan.on(RoomEvent.TrackUnsubscribed, (remoteTrack, _publication, participant) => {
      const key = `${participant.identity}:${remoteTrack.sid}`;
      const stream = bridge.streams.get(key);
      if (!stream) return;
      bridge.streams.delete(key);
      try {
        mixer.removeStream(stream as any);
      } catch {
        /* already gone */
      }
      refreshState();
    });
    jordan.on(RoomEvent.Disconnected, () => {
      if (bridge.stopping) return;
      bridge.status.state = 'error';
      bridge.status.error = 'The Jordan room closed or the connection dropped.';
      changed();
      void stopJordanBridge(input.sessionId, { keepStatus: true });
    });
    await jordan.connect(
      env.livekitUrl,
      await mintToken({
        roomName: jordanRoomName,
        identity: `${BRIDGE_IDENTITY_PREFIX}-${input.sessionId}`.slice(0, 120),
        name: 'PLCC Sanctum overflow',
        publish: false,
        hidden: true,
      }),
      { autoSubscribe: true, dynacast: false }
    );
    refreshState();
    return { ...bridge.status };
  } catch (err: any) {
    const message = String(err?.message || err || 'Could not start the bridge.');
    bridge.status.state = 'error';
    bridge.status.error = /full|max/i.test(message)
      ? 'The Jordan room is full (50 people). Free one seat for the bridge, then try again.'
      : message.slice(0, 200);
    changed();
    await stopJordanBridge(input.sessionId, { keepStatus: true });
    throw new Error(bridge.status.error);
  }
}

export async function stopJordanBridge(sessionId: string, opts: { keepStatus?: boolean } = {}): Promise<void> {
  const bridge = bridges.get(sessionId);
  if (!bridge) return;
  bridge.stopping = true;
  for (const stream of bridge.streams.values()) {
    try {
      bridge.mixer?.removeStream(stream as any);
    } catch {
      /* ignore */
    }
  }
  bridge.streams.clear();
  await Promise.allSettled([
    bridge.mixer?.aclose(),
    bridge.jordan?.disconnect(),
    bridge.sanctum?.disconnect(),
  ]);
  if (opts.keepStatus) {
    if (bridge.status.state !== 'error') bridge.status.state = 'stopped';
    bridge.status.speakers = 0;
  } else {
    bridges.delete(sessionId);
  }
}
