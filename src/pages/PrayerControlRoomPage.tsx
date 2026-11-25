import React, { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { PrayerCountdownTimer } from '../components/dashboard/PrayerCountdownTimer';
import { RealtimeEngineStatus } from '../components/common/RealtimeEngineStatus';
import { LocalMicStatus } from '../components/common/LocalMicStatus';
import { TestPrayerRoomModal } from '../components/dashboard/TestPrayerRoomModal';
import { PrePrayerCheckModal } from '../components/dashboard/PrePrayerCheckModal';
import { OpenSanctuaryModal } from '../components/dashboard/OpenSanctuaryModal';
import { PrayerChatPanel } from '../components/public/PrayerChatPanel';
import { resolveAltarLink } from '../services/altarLinkResolver';
import {
  Sliders,
  Hand,
  Mic,
  MicOff,
  Users,
  FileText,
  Search,
  ExternalLink,
  ShieldCheck,
  MessageCircle,
  VolumeX,
  CircleHelp,
  Volume2,
  LayoutDashboard,
  Radio,
  Timer,
  MoreHorizontal,
  X,
  Crown,
  HeartHandshake,
  Power,
  Link2,
  UserMinus,
  UserCheck,
  UserX,
} from 'lucide-react';
import { sanctumTheme } from '../components/public/ChurchWordmark';
import { Role } from '../types';
import { canMuteCongregation, canModerate, hasPermission } from '../lib/permissions';
import { livekitRealtimeProvider } from '../services/realtime/livekitRealtimeProvider';
import { useTour } from '../hooks/useTour';
import { TOUR_IDS } from '../tour/tourIds';
import { controlRoomTourSteps } from '../tour/controlRoomTour';
import { isPastorJourneyComplete } from '../tour/pastorJourney/storage';

interface PrayerControlRoomPageProps {
  roomId: string;
  onNavigate: (path: string) => void;
}

export const PrayerControlRoomPage: React.FC<PrayerControlRoomPageProps> = ({
  roomId,
  onNavigate,
}) => {
  const {
    prayerRooms = [],
    liveSession,
    historySessions = [],
    participants = [],
    raisedHands = [],
    prayerRequests = [],
    inviteSpeaker,
    endSpeaker,
    muteParticipant,
    unmuteParticipant,
    assignRole,
    removeParticipant,
    dismissRaisedHand,
    endLiveSession,
    startPrayerSession,
    openSanctuary,
    addToast,
    confirmAction,
    connectedNow,
    connectionState,
    connectControlRoom,
    setCongregationMuted,
    startPrivatePrayer,
    endPrivatePrayer,
    isDarkMode,
  } = useApp();

  const { organization, user } = useAuth();
  const canControlCongregation =
    user?.role === 'OWNER' || user?.role === 'ADMIN' ? canMuteCongregation(user.role) : false;
  const congregationMuted = liveSession?.congregationMuted !== false;
  const discussionOpen = !congregationMuted;
  const canMuteIndividuals = user?.role ? canModerate(user.role) : false;
  const room = (prayerRooms || []).find((r) => r?.id === roomId) || (prayerRooms || [])[0];
  const sermonLeaderName = liveSession?.sermonLeaderName?.trim() || '';
  const isSermonLeader =
    Boolean(sermonLeaderName && user?.name) &&
    sermonLeaderName.toLocaleLowerCase() === user?.name?.trim().toLocaleLowerCase();
  const visiblePrayerRequests = (prayerRequests || []).filter(
    (req) => !req.isPrivate || hasPermission(user?.role || 'LISTENER', 'canViewPrivateRequests')
  );
  const raisedHandIds = new Set((raisedHands || []).map((hand) => hand.participantId));
  const prayerRequestIds = new Set(
    visiblePrayerRequests
      .filter((req) => req.status === 'PENDING' || req.status === 'ANSWERED')
      .map((req) => req.participantId)
      .filter((id): id is string => Boolean(id))
  );
  const privateHoldRef = React.useRef(false);

  const resolution = resolveAltarLink(room, liveSession, historySessions);
  const isLive = resolution.status === 'LIVE';

  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'ALL' | Role>('ALL');
  const [activeTab, setActiveTab] = useState<'HANDS' | 'PEOPLE' | 'REQUESTS' | 'CHAT'>('HANDS');
  const [personMenuId, setPersonMenuId] = useState<string | null>(null);
  const [timerOpen, setTimerOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const sidePanel = React.useRef<HTMLElement | null>(null);
  const showSide = (tab: 'HANDS' | 'PEOPLE' | 'REQUESTS' | 'CHAT') => {
    setActiveTab(tab);
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches) {
      window.requestAnimationFrame(() => sidePanel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  };
  const [showTestRoomModal, setShowTestRoomModal] = useState(false);
  const [showPrePrayerModal, setShowPrePrayerModal] = useState(false);
  const [showOpenSanctuaryModal, setShowOpenSanctuaryModal] = useState(false);
  const [hostMicOn, setHostMicOn] = useState(false);
  const [hostMicBusy, setHostMicBusy] = useState(false);
  const [micOnByIdentity, setMicOnByIdentity] = useState<Record<string, boolean>>({});
  const { startTour } = useTour(TOUR_IDS.controlRoom, controlRoomTourSteps, {
    delayMs: 800,
    enabled: isPastorJourneyComplete(),
  });

  // Filter participants
  const speakers = (participants || []).filter((p) => p && p.role === 'SPEAKER');
  const filteredParticipants = (participants || []).filter((p) => {
    if (!p) return false;
    const matchesSearch =
      (p.displayName || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.country && p.country.toLowerCase().includes(searchQuery.toLowerCase()));

    if (!matchesSearch) return false;
    if (roleFilter !== 'ALL') return p.role === roleFilter;
    return true;
  });

  const sessionDuration = liveSession?.durationSeconds || 0;
  const liveConnected = connectionState === 'CONNECTED';
  const totalCount = isLive || resolution.status === 'WAITING' ? connectedNow || undefined : undefined;

  useEffect(() => {
    if (!room?.id) return;
    void connectControlRoom(room.id);
    if (resolution.status === 'SCHEDULED' || resolution.status === 'ENDED') {
      const timer = window.setInterval(() => {
        void connectControlRoom(room.id);
      }, 1500);
      return () => window.clearInterval(timer);
    }
  }, [room?.id, liveSession?.id, resolution.status]);

  useEffect(() => {
    const syncMics = () => {
      const states = livekitRealtimeProvider.getMicStates();
      setMicOnByIdentity(states);
      const identity = livekitRealtimeProvider.getIdentity();
      if (identity) {
        setHostMicOn(Boolean(states[identity]));
      }
    };
    syncMics();
    const unsubscribe = livekitRealtimeProvider.subscribe(syncMics);
    const timer = window.setInterval(syncMics, 1000);
    return () => {
      unsubscribe();
      window.clearInterval(timer);
    };
  }, [liveConnected, connectionState]);

  const handleEndSessionClick = () => {
    confirmAction({
      title: 'End Live Prayer Gathering?',
      description:
        'This will conclude the active corporate prayer session for everyone in the room, safely disconnect all attendee audio streams, and archive attendance stats.',
      confirmText: 'Yes, End Session',
      cancelText: 'Continue Praying',
      isDestructive: true,
      onConfirm: async () => {
        if (liveSession) {
          await endLiveSession(liveSession.id);
        }
        addToast('Prayer session concluded successfully. God bless your ministry!', 'success');
        onNavigate('/dashboard');
      },
    });
  };

  const handleStartFromPrePrayer = (sermonLeaderName: string) => {
    void startPrayerSession(room.id, sermonLeaderName);
  };

  const handleToggleHostMic = async () => {
    setHostMicBusy(true);
    try {
      if (!liveConnected && room?.id) {
        await connectControlRoom(room.id);
      }
      if (hostMicOn) {
        await livekitRealtimeProvider.disableMicrophone();
        setHostMicOn(false);
        addToast('Microphone muted', 'info');
        return;
      }
      await livekitRealtimeProvider.enableMicrophone();
      setHostMicOn(true);
      addToast('Your microphone is on. The congregation can hear you lead.', 'success');
    } catch (error) {
      addToast(
        error instanceof Error
          ? error.message
          : 'Allow microphone access in the browser to lead in prayer.',
        'error'
      );
    } finally {
      setHostMicBusy(false);
    }
  };

  const staffTheme = sanctumTheme(Boolean(isDarkMode));
  const localIdentity = livekitRealtimeProvider.getIdentity();
  const roomOpen = resolution.status === 'WAITING' || isLive;
  const people = (participants || []).filter((p) => p && !p.leftAt);
  const isMinisterRole = (role: Role) => ['OWNER', 'ADMIN', 'PRAYER_LEADER', 'TECHNICAL_ADMIN'].includes(role);
  const micOf = (p: (typeof people)[number]) =>
    Boolean(p.externalIdentity && micOnByIdentity[p.externalIdentity]) ||
    p.id === liveSession?.pttParticipantId ||
    p.id === liveSession?.privatePrayer?.memberParticipantId;
  const shownPeople = filteredParticipants
    .filter((p) => !p.leftAt)
    .sort((a, b) => {
      const la = micOf(a) ? 0 : raisedHandIds.has(a.id) ? 1 : 2;
      const lb = micOf(b) ? 0 : raisedHandIds.has(b.id) ? 1 : 2;
      return la - lb || (a.displayName || '').localeCompare(b.displayName || '');
    });
  const menuPerson = personMenuId ? people.find((p) => p.id === personMenuId) || null : null;
  const initialsOf = (name: string) =>
    (name || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?';
  const timeAgo = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const durationLabel = (() => {
    const m = Math.floor(sessionDuration / 60);
    const h = Math.floor(m / 60);
    return h ? `${h}h ${m % 60}m` : `${m}m`;
  })();
  const modeLabel = liveSession?.privatePrayer ? 'Private prayer' : congregationMuted ? 'Sermon mode' : 'Floor open';
  const statusChip =
    resolution.status === 'LIVE' ? (
      <span className="pr-live"><i aria-hidden /> LIVE</span>
    ) : resolution.status === 'WAITING' ? (
      <span className="pr-live" style={{ background: '#a07a2c' }}>WAITING</span>
    ) : (
      <span className="pr-live" style={{ background: '#6b7a72' }}>CLOSED</span>
    );

  const toggleFloor = () => {
    if (congregationMuted) {
      confirmAction({
        title: 'Open the floor for prayer?',
        description: 'Congregants will hold to speak, one at a time. This does not turn on your host microphone.',
        confirmText: 'Open the floor',
        cancelText: 'Keep Sermon mode',
        onConfirm: () => void setCongregationMuted(false),
      });
      return;
    }
    confirmAction({
      title: 'Return to Sermon mode?',
      description: 'Everyone except the pastor and ministers will be muted. Use this for preaching and opening prayer.',
      confirmText: 'Sermon mode',
      cancelText: 'Keep the floor open',
      isDestructive: true,
      onConfirm: () => void setCongregationMuted(true),
    });
  };

  const removePerson = (id: string, name: string) => {
    setPersonMenuId(null);
    confirmAction({
      title: `Remove ${name}?`,
      description: `${name} will be disconnected from this prayer gathering.`,
      confirmText: 'Remove',
      cancelText: 'Keep in gathering',
      isDestructive: true,
      onConfirm: () => removeParticipant(id),
    });
  };

  const openJoinLink = () => {
    if (!room?.slug) return;
    window.open(`${window.location.origin}/join/${room.slug}`, '_blank', 'noopener,noreferrer');
  };

  const callControls = (
    <div className="pr-controls" data-tour="control-host-mic">
      <button
        type="button"
        disabled={hostMicBusy || !roomOpen}
        onClick={() => void handleToggleHostMic()}
        aria-pressed={hostMicOn}
        className={`pr-ctl ${hostMicOn ? 'is-live' : ''} ${!roomOpen ? 'is-disabled' : ''}`}
      >
        {hostMicOn ? <Mic aria-hidden /> : <MicOff aria-hidden />}
        <span>{hostMicOn ? 'Mute' : 'Unmute'}</span>
      </button>
      {canControlCongregation ? (
        <button
          type="button"
          disabled={!roomOpen}
          onClick={toggleFloor}
          data-tour="control-congregation-mute"
          aria-pressed={!congregationMuted}
          className={`pr-ctl is-gold ${!congregationMuted ? 'is-on' : ''} ${!roomOpen ? 'is-disabled' : ''}`}
        >
          {congregationMuted ? <Volume2 aria-hidden /> : <VolumeX aria-hidden />}
          <span>{congregationMuted ? 'Open Floor' : 'Sermon Mode'}</span>
        </button>
      ) : null}
      <button type="button" onClick={() => showSide('HANDS')} className="pr-ctl" data-tour="control-raised-hands">
        <span style={{ position: 'relative', display: 'inline-flex' }}>
          <Hand aria-hidden />
          {raisedHands.length ? <span className="mod-badge">{raisedHands.length}</span> : null}
        </span>
        <span>Hands</span>
      </button>
      <span className="pr-ctl-gap" aria-hidden />
      {isLive ? (
        <button type="button" onClick={handleEndSessionClick} data-tour="control-end" className="pr-ctl is-leave">
          <Power aria-hidden />
          <span>End Prayer</span>
        </button>
      ) : (
        <button type="button" onClick={() => onNavigate('/dashboard')} className="pr-ctl">
          <LayoutDashboard aria-hidden />
          <span>Dashboard</span>
        </button>
      )}
    </div>
  );

  return (
    <div className="pr-shell min-h-screen select-none" style={{ height: 'auto', minHeight: '100vh' }}>
      <header className="pr-header">
        <div className="pr-header-inner">
          <button type="button" onClick={() => onNavigate('/dashboard')} className="pr-brand cursor-pointer" aria-label="Back to the dashboard">
            <img src="/prayer-room/prayer-emblem.png" alt="" aria-hidden className="pr-emblem" />
            <div className="min-w-0 text-left">
              <p className="pr-brand-name">PLCC SANCTUM</p>
              <p className="pr-brand-sub">Moderator Room</p>
            </div>
          </button>
          <div className="pr-church">
            <p className="pr-church-name">{organization.name}</p>
            <p className="pr-church-tag">{user?.role === 'ADMIN' ? 'You are moderating as Admin' : isSermonLeader ? 'You are the sermon leader' : 'Lead and moderate the gathering'}</p>
          </div>
          <div className="pr-header-actions">
            <button type="button" onClick={() => startTour()} className="pr-icon-btn cursor-pointer" aria-label="Show the Moderator Room guide">
              <CircleHelp size={22} aria-hidden />
            </button>
            <button type="button" onClick={() => onNavigate(`/dashboard/prayer-rooms/${room?.id || roomId}`)} className="pr-icon-btn is-solid cursor-pointer" aria-label="Back to the prayer room settings">
              <X size={20} aria-hidden />
            </button>
          </div>
        </div>
      </header>

      <div className="pr-body">
        <aside className="pr-sidebar" aria-label="Moderator room">
          <nav className="pr-nav">
            <button type="button" className="pr-nav-item is-active" aria-current="page">
              <Radio size={20} aria-hidden /> Moderator Room
            </button>
            {room?.slug ? (
              <a href={`/join/${room.slug}`} target="_blank" rel="noopener noreferrer" className="pr-nav-item">
                <ExternalLink size={20} aria-hidden /> View as member
              </a>
            ) : null}
            <button type="button" onClick={() => onNavigate('/dashboard/prayer-requests')} className="pr-nav-item cursor-pointer">
              <FileText size={20} aria-hidden /> Prayer Requests
            </button>
            <button type="button" onClick={() => onNavigate('/dashboard/prayer-rooms')} className="pr-nav-item cursor-pointer">
              <Sliders size={20} aria-hidden /> All Rooms
            </button>
            <button type="button" onClick={() => onNavigate('/dashboard')} className="pr-nav-item cursor-pointer">
              <LayoutDashboard size={20} aria-hidden /> Dashboard
            </button>
          </nav>
        </aside>

        <div className="pr-content">
          <main className="pr-room">
            <div className="pr-titlebar" data-tour="control-welcome">
              <span className="pr-room-icon"><Radio aria-hidden /></span>
              <div className="min-w-0 flex-1">
                <p className="pr-room-title">{room?.name || 'Prayer Altar'}</p>
                <p className="pr-room-sub">
                  {roomOpen ? modeLabel : 'Not open yet'}
                  {isLive ? ` • ${durationLabel}` : ''}
                </p>
              </div>
              {statusChip}
              <span className="pr-count" aria-label={`${connectedNow || 0} connected`}>
                <Users aria-hidden /> {connectedNow || 0}
              </span>
            </div>

            {people.length ? (
              <aside className="pr-rail" aria-label="People in the room">
                <ul className="pr-rail-list">
                  {shownPeople.slice(0, 60).map((p) => {
                    const live = micOf(p);
                    return (
                      <li key={p.id}>
                        <button type="button" className="pr-rail-person" onClick={() => setPersonMenuId(p.id)} aria-label={`${p.displayName}${live ? ', mic on' : ''}${raisedHandIds.has(p.id) ? ', hand raised' : ''}`}>
                          <span className={`pr-avatar ${live ? 'is-speaking' : ''} ${isMinisterRole(p.role) ? 'is-mod' : ''}`}>
                            {initialsOf(p.displayName)}
                            {raisedHandIds.has(p.id) ? <span className="pr-rail-hand" aria-hidden>✋</span> : null}
                          </span>
                          <span className="pr-rail-name">{(p.displayName || '').split(/\s+/)[0]}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </aside>
            ) : null}

            {liveSession?.privatePrayer ? (
              <p className="pr-notice is-strong text-center">
                Private prayer is on. Only you and the chosen person can hear each other.
              </p>
            ) : null}

            {roomOpen ? (
              <div className="pr-stage">
                <div className="pr-orb-row">
                  <span className={`pr-wave is-left ${hostMicOn ? 'is-active' : ''}`} aria-hidden>
                    {Array.from({ length: 9 }).map((_, n) => <i key={n} style={{ animationDelay: `${n * 0.11}s` }} />)}
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleToggleHostMic()}
                    disabled={hostMicBusy}
                    aria-label={hostMicOn ? 'Mute your microphone' : 'Turn on your microphone'}
                    className={`pr-orb cursor-pointer ${hostMicOn ? 'is-open is-speaking' : ''}`}
                  >
                    {hostMicOn ? <Mic aria-hidden /> : <MicOff aria-hidden />}
                  </button>
                  <span className={`pr-wave ${hostMicOn ? 'is-active' : ''}`} aria-hidden>
                    {Array.from({ length: 9 }).map((_, n) => <i key={n} style={{ animationDelay: `${n * 0.11}s` }} />)}
                  </span>
                </div>
                <p className={`pr-status ${hostMicOn ? 'is-open' : ''}`}>
                  {hostMicOn ? <Mic size={20} aria-hidden /> : <MicOff size={20} aria-hidden />}
                  {hostMicOn ? 'You are live' : 'Your mic is off'}
                </p>
                <p className="pr-hint">
                  {liveSession?.activeSpeakerName ? (
                    <>Now praying: <strong>{liveSession.activeSpeakerName}</strong></>
                  ) : sermonLeaderName ? (
                    <>Sermon leader: <strong>{sermonLeaderName}</strong></>
                  ) : hostMicOn ? (
                    'The congregation can hear you'
                  ) : (
                    'Tap the mic to lead the congregation'
                  )}
                </p>
              </div>
            ) : (
              <div className="pr-stage" data-tour="control-start">
                <span className="pr-orb" aria-hidden><Radio /></span>
                <p className="pr-status">The room is not open yet</p>
                <p className="pr-hint">Open the sanctuary so members can join, then start prayer when you are ready.</p>
                <div className="mod-start">
                  {resolution.status === 'SCHEDULED' || resolution.status === 'ENDED' ? (
                    <button type="button" onClick={() => setShowOpenSanctuaryModal(true)} data-tour="control-open-sanctuary" className="mod-btn is-primary cursor-pointer">
                      <Mic size={18} aria-hidden /> Open sanctuary
                    </button>
                  ) : null}
                  <button type="button" onClick={() => setShowPrePrayerModal(true)} data-tour="control-pre-prayer" className="mod-btn cursor-pointer">
                    <ShieldCheck size={18} aria-hidden /> Pre-Prayer Check
                  </button>
                  <button type="button" onClick={() => setShowTestRoomModal(true)} className="mod-btn cursor-pointer">
                    <Sliders size={18} aria-hidden /> Test room
                  </button>
                </div>
              </div>
            )}

            {resolution.status === 'WAITING' ? (
              <button type="button" onClick={() => void startPrayerSession(room.id, liveSession?.sermonLeaderName || '')} className="mod-go cursor-pointer" data-tour="control-start">
                <Mic size={20} aria-hidden /> Start Prayer — go live for everyone
              </button>
            ) : null}

            {callControls}

            <div className="pr-tools" role="toolbar" aria-label="Moderator tools">
              <button type="button" onClick={() => setTimerOpen(true)} className="pr-tool cursor-pointer">
                <Timer size={17} aria-hidden /> <span>Prayer timer</span>
              </button>
              <button type="button" onClick={() => showSide('CHAT')} className="pr-tool is-icon cursor-pointer" aria-label="Chat" title="Chat" data-tour="control-chat-tab">
                <MessageCircle size={18} aria-hidden />
              </button>
              <button type="button" onClick={openJoinLink} className="pr-tool cursor-pointer">
                <Link2 size={17} aria-hidden /> <span>Join link</span>
              </button>
              <button type="button" onClick={() => setMoreOpen(true)} className="pr-tool is-icon cursor-pointer" aria-label="More tools" aria-haspopup="dialog" title="More">
                <MoreHorizontal size={18} aria-hidden />
              </button>
            </div>
          </main>

          <aside ref={sidePanel} className="pr-side" aria-label="Moderator panels">
            <div className="pr-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={activeTab === 'HANDS'} onClick={() => setActiveTab('HANDS')} className={`pr-tab cursor-pointer ${activeTab === 'HANDS' ? 'is-active' : ''}`}>
                Hands{raisedHands.length ? ` ${raisedHands.length}` : ''}
              </button>
              <button type="button" role="tab" aria-selected={activeTab === 'PEOPLE'} onClick={() => setActiveTab('PEOPLE')} className={`pr-tab cursor-pointer ${activeTab === 'PEOPLE' ? 'is-active' : ''}`} data-tour="control-roster">
                People
              </button>
              <button type="button" role="tab" aria-selected={activeTab === 'REQUESTS'} onClick={() => setActiveTab('REQUESTS')} className={`pr-tab cursor-pointer ${activeTab === 'REQUESTS' ? 'is-active' : ''}`}>
                Requests
              </button>
              <button type="button" role="tab" aria-selected={activeTab === 'CHAT'} onClick={() => setActiveTab('CHAT')} className={`pr-tab cursor-pointer ${activeTab === 'CHAT' ? 'is-active' : ''}`}>
                Chat
              </button>
            </div>

            {activeTab === 'HANDS' ? (
              <ul className="pr-people">
                {raisedHands.map((hand, i) => (
                  <li key={hand.id} className="pr-person">
                    <span className="mod-order">{i + 1}</span>
                    <span className="pr-avatar">{initialsOf(hand.participantName)}</span>
                    <span className="pr-person-name">{hand.participantName}</span>
                    <button type="button" disabled={!isLive} onClick={() => inviteSpeaker(hand.participantId)} className="mod-pill is-go cursor-pointer" title={isLive ? 'Invite to pray' : 'Start prayer first'}>
                      Invite
                    </button>
                    <button type="button" onClick={() => dismissRaisedHand(hand.id)} className="mod-pill cursor-pointer" aria-label={`Lower ${hand.participantName}'s hand`}>
                      <X size={14} aria-hidden />
                    </button>
                  </li>
                ))}
                {!raisedHands.length ? <li className="pr-side-empty">No raised hands. When someone raises a hand, they appear here in order.</li> : null}
                {speakers.length ? (
                  <>
                    <li className="mod-section">Praying now</li>
                    {speakers.map((sp) => (
                      <li key={sp.id} className="pr-person">
                        <span className="pr-avatar is-speaking">{initialsOf(sp.displayName)}</span>
                        <span className="pr-person-name">{sp.displayName}</span>
                        <button type="button" onClick={() => (sp.isMuted ? unmuteParticipant(sp.id) : muteParticipant(sp.id))} className="mod-pill cursor-pointer">
                          {sp.isMuted ? 'Unmute' : 'Mute'}
                        </button>
                        <button type="button" onClick={() => endSpeaker(sp.id)} className="mod-pill is-stop cursor-pointer">Done</button>
                      </li>
                    ))}
                  </>
                ) : null}
              </ul>
            ) : activeTab === 'PEOPLE' ? (
              <>
                <label className="pr-search">
                  <Search size={16} aria-hidden className="opacity-60" />
                  <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search people…" aria-label="Search people" />
                </label>
                <div className="mod-filters" role="radiogroup" aria-label="Filter by role">
                  {([['ALL', 'All'], ['LISTENER', 'Listeners'], ['SPEAKER', 'Praying'], ['PRAYER_LEADER', 'Leaders']] as const).map(([v, label]) => (
                    <button key={v} type="button" role="radio" aria-checked={roleFilter === v} onClick={() => setRoleFilter(v as 'ALL' | Role)} className={`mod-filter cursor-pointer ${roleFilter === v ? 'is-on' : ''}`}>
                      {label}
                    </button>
                  ))}
                </div>
                <p className="mod-help">Tap a person for actions{canControlCongregation ? ', including private prayer' : ''}.</p>
                <ul className="pr-people">
                  {shownPeople.slice(0, 200).map((p) => {
                    const live = micOf(p);
                    const isMe = Boolean(localIdentity && p.externalIdentity === localIdentity);
                    return (
                      <li key={p.id}>
                        <button type="button" onClick={() => setPersonMenuId(p.id)} className="pr-person w-full cursor-pointer text-left">
                          <span className={`pr-avatar ${live ? 'is-speaking' : ''}`}>{initialsOf(p.displayName)}</span>
                          <span className="pr-person-name">{p.displayName}{isMe ? ' (you)' : ''}</span>
                          {raisedHandIds.has(p.id) ? <Hand size={15} className="pr-hand" aria-label="Hand raised" /> : null}
                          {prayerRequestIds.has(p.id) ? <HeartHandshake size={15} className="pr-hand" aria-label="Has a prayer request" /> : null}
                          {liveSession?.privatePrayer?.memberParticipantId === p.id ? (
                            <span className="pr-role is-mod">Private</span>
                          ) : p.role === 'SPEAKER' ? (
                            <span className="pr-role is-speaking">Praying</span>
                          ) : isMinisterRole(p.role) ? (
                            <span className="pr-role is-mod"><Crown size={12} aria-hidden /> Leader</span>
                          ) : null}
                          {live ? <Mic size={16} className="pr-mic-on" aria-label="Mic on" /> : <MicOff size={16} className="pr-mic-off" aria-label="Muted" />}
                        </button>
                      </li>
                    );
                  })}
                  {!shownPeople.length ? (
                    <li className="pr-side-empty">{people.length ? 'No one matches.' : 'No one has joined yet. Members join from the join link.'}</li>
                  ) : null}
                </ul>
              </>
            ) : activeTab === 'REQUESTS' ? (
              <ul className="pr-people">
                {visiblePrayerRequests.map((req) => (
                  <li key={req.id} className="mod-request">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold">{req.participantName}</span>
                      <span className="text-[11px] opacity-60">{timeAgo(req.createdAt)}</span>
                    </div>
                    <p className="mt-1 text-[13px] leading-relaxed opacity-85">{req.request}</p>
                  </li>
                ))}
                {!visiblePrayerRequests.length ? <li className="pr-side-empty">No prayer requests yet.</li> : null}
                <li>
                  <button type="button" onClick={() => onNavigate('/dashboard/prayer-requests')} className="pr-tool mt-2 w-full justify-center cursor-pointer">
                    <FileText size={16} aria-hidden /> Open all prayer requests
                  </button>
                </li>
              </ul>
            ) : (
              <div data-theme="light" className="min-h-0 flex-1">
                <PrayerChatPanel sessionId={liveSession?.id} senderName={user?.name || 'Prayer Leader'} compact />
              </div>
            )}
          </aside>
        </div>
      </div>

      {menuPerson ? (
        <div className="pr-sheet-backdrop" onClick={() => setPersonMenuId(null)} role="presentation">
          <div className="pr-sheet pr-more" role="dialog" aria-modal="true" aria-label={`Actions for ${menuPerson.displayName}`} onClick={(e) => e.stopPropagation()}>
            <div className="pr-more-head">
              <p>{menuPerson.displayName}</p>
              <button type="button" onClick={() => setPersonMenuId(null)} className="pr-more-close" aria-label="Close"><X size={18} aria-hidden /></button>
            </div>
            <div className="pr-more-grid">
              {isLive && menuPerson.role !== 'SPEAKER' ? (
                <button type="button" className="pr-more-item" onClick={() => { inviteSpeaker(menuPerson.id); setPersonMenuId(null); }}>
                  <Mic size={20} aria-hidden /> <span>Invite to pray</span>
                </button>
              ) : null}
              {menuPerson.role === 'SPEAKER' ? (
                <button type="button" className="pr-more-item" onClick={() => { endSpeaker(menuPerson.id); setPersonMenuId(null); }}>
                  <MicOff size={20} aria-hidden /> <span>End their turn</span>
                </button>
              ) : null}
              {canMuteIndividuals ? (
                <button type="button" className="pr-more-item" onClick={() => { void (menuPerson.isMuted ? unmuteParticipant(menuPerson.id) : muteParticipant(menuPerson.id)); setPersonMenuId(null); }}>
                  {menuPerson.isMuted ? <Mic size={20} aria-hidden /> : <MicOff size={20} aria-hidden />} <span>{menuPerson.isMuted ? 'Unmute' : 'Mute'}</span>
                </button>
              ) : null}
              {menuPerson.role === 'PRAYER_LEADER' ? (
                <button type="button" className="pr-more-item" onClick={() => { assignRole(menuPerson.id, 'LISTENER'); setPersonMenuId(null); }}>
                  <UserMinus size={20} aria-hidden /> <span>Back to listener</span>
                </button>
              ) : !isMinisterRole(menuPerson.role) ? (
                <button type="button" className="pr-more-item" onClick={() => { assignRole(menuPerson.id, 'PRAYER_LEADER'); setPersonMenuId(null); }}>
                  <UserCheck size={20} aria-hidden /> <span>Make prayer leader</span>
                </button>
              ) : null}
              <button type="button" className="pr-more-item is-end" onClick={() => removePerson(menuPerson.id, menuPerson.displayName)}>
                <UserX size={20} aria-hidden /> <span>Remove</span>
              </button>
            </div>
            {canControlCongregation && roomOpen && !isMinisterRole(menuPerson.role) ? (
              <>
                <p className="pr-more-label">Private prayer</p>
                <button
                  type="button"
                  className={`mod-hold ${liveSession?.privatePrayer?.memberParticipantId === menuPerson.id ? 'is-on' : ''}`}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    e.currentTarget.setPointerCapture(e.pointerId);
                    privateHoldRef.current = true;
                    void startPrivatePrayer(menuPerson.id);
                  }}
                  onPointerUp={() => {
                    if (!privateHoldRef.current) return;
                    privateHoldRef.current = false;
                    void endPrivatePrayer();
                  }}
                  onPointerCancel={() => {
                    if (!privateHoldRef.current) return;
                    privateHoldRef.current = false;
                    void endPrivatePrayer();
                  }}
                  onContextMenu={(e) => e.preventDefault()}
                >
                  <HeartHandshake size={20} aria-hidden />
                  {liveSession?.privatePrayer?.memberParticipantId === menuPerson.id ? 'Praying privately… release to end' : 'Press and hold to pray privately'}
                </button>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {moreOpen ? (
        <div className="pr-sheet-backdrop" onClick={() => setMoreOpen(false)} role="presentation">
          <div className="pr-sheet pr-more" role="dialog" aria-modal="true" aria-label="More tools" onClick={(e) => e.stopPropagation()}>
            <div className="pr-more-head">
              <p>More</p>
              <button type="button" onClick={() => setMoreOpen(false)} className="pr-more-close" aria-label="Close"><X size={18} aria-hidden /></button>
            </div>
            <div className="pr-more-grid">
              <button type="button" className="pr-more-item" onClick={() => { setMoreOpen(false); setShowPrePrayerModal(true); }}>
                <ShieldCheck size={20} aria-hidden /> <span>Pre-Prayer Check</span>
              </button>
              <button type="button" className="pr-more-item" onClick={() => { setMoreOpen(false); setShowTestRoomModal(true); }}>
                <Sliders size={20} aria-hidden /> <span>Test room</span>
              </button>
              {room?.slug ? (
                <a href={`/join/${room.slug}`} target="_blank" rel="noopener noreferrer" className="pr-more-item" onClick={() => setMoreOpen(false)}>
                  <ExternalLink size={20} aria-hidden /> <span>View as member</span>
                </a>
              ) : null}
              <button type="button" className="pr-more-item" onClick={() => { setMoreOpen(false); onNavigate('/dashboard/prayer-requests'); }}>
                <FileText size={20} aria-hidden /> <span>Prayer requests</span>
              </button>
              <button type="button" className="pr-more-item" onClick={() => { setMoreOpen(false); startTour(); }}>
                <CircleHelp size={20} aria-hidden /> <span>Guide</span>
              </button>
              <button type="button" className="pr-more-item" onClick={() => { setMoreOpen(false); onNavigate('/dashboard'); }}>
                <LayoutDashboard size={20} aria-hidden /> <span>Dashboard</span>
              </button>
            </div>
            <p className="pr-more-label">Connection</p>
            <div className="flex flex-wrap items-center justify-between gap-2" data-staff data-staff-theme="light">
              <LocalMicStatus />
              <RealtimeEngineStatus />
            </div>
          </div>
        </div>
      ) : null}

      <div data-staff data-staff-theme={staffTheme}>
      {/* Kept mounted so a running prayer timer keeps counting while the sheet is closed. */}
      {(
        <div className="pr-sheet-backdrop" style={timerOpen ? undefined : { display: 'none' }} onClick={() => setTimerOpen(false)} role="presentation">
          <div className="pr-sheet" role="dialog" aria-modal="true" aria-label="Prayer timer" onClick={(e) => e.stopPropagation()}>
            <div className="pr-more-head">
              <p>Prayer timer</p>
              <button type="button" onClick={() => setTimerOpen(false)} className="pr-more-close" aria-label="Close"><X size={18} aria-hidden /></button>
            </div>
            <PrayerCountdownTimer
              initialMinutes={5}
              activeSpeakerName={liveSession?.activeSpeakerName}
              onTimeExpired={() => addToast('Prayer segment timer expired — conclude speaker turn', 'warning')}
            />
          </div>
        </div>
      )}
      {/* Modals */}
      <TestPrayerRoomModal
        isOpen={showTestRoomModal}
        onClose={() => setShowTestRoomModal(false)}
        roomName={room?.name || 'Morning Prayer'}
      />

      <PrePrayerCheckModal
        isOpen={showPrePrayerModal}
        onClose={() => setShowPrePrayerModal(false)}
        room={room}
        session={liveSession}
        waitingCount={liveSession?.status === 'WAITING' ? (liveSession.listenersWaitingCount || participants.length || 0) : 0}
        onStartPrayer={handleStartFromPrePrayer}
      />
      <OpenSanctuaryModal
        isOpen={showOpenSanctuaryModal}
        roomName={room?.name || 'Prayer Altar'}
        onClose={() => setShowOpenSanctuaryModal(false)}
        onSubmit={(sermonLeaderName) => {
          setShowOpenSanctuaryModal(false);
          void openSanctuary(room.id, sermonLeaderName);
        }}
      />
      </div>
    </div>
  );
};
