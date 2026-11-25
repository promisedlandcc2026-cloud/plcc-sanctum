import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { loadJoinSession } from '../../services/realtime/joinSessionStore';
import { churchSiteUrl } from '../../lib/appMode';
import { ConnectionStatus } from '../common/ConnectionStatus';
import { PrayerRequestModal } from './PrayerRequestModal';
import { InvitedSpeakerBanner } from './InvitedSpeakerBanner';
import { PrayerChatPanel } from './PrayerChatPanel';
import { SpeakerLiveView } from './SpeakerLiveView';
import { PostPrayerSummaryView } from './PostPrayerSummaryView';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { isClientMinister } from '../../lib/permissions';
import { LogOut, Volume2, LayoutDashboard, Mic, MicOff, CircleHelp, Hand, Headphones, Users, Info, ShieldCheck, Search, Megaphone, X, Radio, LayoutGrid, HandHeart, BookHeart, BookOpen, Crown, VolumeX, MessageCircle, MoreHorizontal, GraduationCap, Settings2 } from 'lucide-react';
import { sanctumApi } from '../../services/api/sanctumApi';
import { livekitRealtimeProvider } from '../../services/realtime/livekitRealtimeProvider';
import { connectionStateToQuality } from '../../services/domain/sessionSnapshot';
import { useTour } from '../../hooks/useTour';
import { TOUR_IDS } from '../../tour/tourIds';
import { listenerRoomTourSteps } from '../../tour/listenerRoomTour';
import { resolveSermonLeader } from '../../../shared/joinDisplay.ts';
import { PLCC_ONE_ORIGIN } from '../../lib/plccLinks';
import { PrayerGuidelinesSheet } from './PrayerGuidelinesSheet';
import { broadcastSender, isBroadcastName } from '../../../shared/broadcast.ts';

const BibleReader = lazy(() => import('../bible/BibleReader').then(({ BibleReader }) => ({ default: BibleReader })));

interface ListenerRoomViewProps {
  participantName: string;
  roomSlug: string;
  onLeave: () => void;
}

export const ListenerRoomView: React.FC<ListenerRoomViewProps> = ({
  participantName,
  roomSlug,
  onLeave,
}) => {
  const {
    liveSession,
    prayerRooms,
    raiseHandAttendee,
    lowerHandAttendee,
    sendReactionAttendee,
    isDarkMode,
    toggleDarkMode,
    connectionState,
    connectedNow,
    audioBlocked,
    localParticipantId,
    pendingSpeakerInvite,
    prayerComplete,
    enablePrayerAudio,
    reconnectToPrayer,
    acceptSpeakerInvite,
    declineSpeakerInvite,
    endSpeaker,
    participants,
    addToast,
    startPtt,
    endPtt,
  } = useApp();
  const { isAuthenticated, authReady, user } = useAuth();

  const [isHandRaised, setIsHandRaised] = useState(false);
  const [isPrayerRequestOpen, setIsPrayerRequestOpen] = useState(false);
  const [canControl, setCanControl] = useState(false);
  const [altarFlags, setAltarFlags] = useState<{
    id?: string;
    name?: string;
    roomSermonLeaderName?: string;
    defaultSermonSpeaker?: string;
    speakerPermission?: string;
    prayerRequestsEnabled?: boolean;
    anonymousRequestsAllowed?: boolean;
    chatEnabled?: boolean;
  } | null>(null);
  const [selfMuted, setSelfMuted] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [pttActive, setPttActive] = useState(false);
  const [participantQuery, setParticipantQuery] = useState('');
  const [peopleSearchOpen, setPeopleSearchOpen] = useState(false);
  const [listenOnly, setListenOnly] = useState(false);
  const [bibleOpen, setBibleOpen] = useState(false);
  const [bibleVisited, setBibleVisited] = useState(false);
  const [playbackMuted, setPlaybackMuted] = useState(false);
  const bibleButton = useRef<HTMLButtonElement>(null);
  const bibleHeading = useRef<HTMLHeadingElement>(null);
  const [guidelinesOpen, setGuidelinesOpen] = useState(false);
  /** Ka Link layout: side panel tab and the More sheet. */
  const [sideTab, setSideTab] = useState<'people' | 'chat' | 'info'>('people');
  const [moreOpen, setMoreOpen] = useState(false);
  const sidePanel = useRef<HTMLElement | null>(null);
  /** Pick a side-panel tab; on phones the panel sits under the room, so bring it into view. */
  const showSide = (tab: 'people' | 'chat' | 'info') => {
    setSideTab(tab);
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches) {
      window.requestAnimationFrame(() => sidePanel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  };
  const [jordanBridge, setJordanBridge] = useState<{ active: boolean; jordanRoomTitle?: string; speakers?: number } | null>(null);
  const [announcement, setAnnouncement] = useState<{ id: string; body: string; from: string; at: string } | null>(null);
  const [dismissedAnnouncement, setDismissedAnnouncement] = useState<string | null>(null);
  const { startTour } = useTour(TOUR_IDS.listenerRoom, listenerRoomTourSteps, { delayMs: 900 });

  useEffect(() => {
    if (!bibleOpen) return;
    const heading = bibleHeading.current;
    heading?.focus({ preventScroll: true });
    heading?.closest('section')?.scrollIntoView({ block: window.matchMedia('(min-width: 1024px)').matches ? 'nearest' : 'start' });
  }, [bibleOpen]);

  useEffect(() => () => livekitRealtimeProvider.setPlaybackMuted(false), []);

  const closeBible = () => {
    setBibleOpen(false);
    bibleButton.current?.focus();
  };

  const togglePlayback = () => {
    const muted = !playbackMuted;
    livekitRealtimeProvider.setPlaybackMuted(muted);
    setPlaybackMuted(muted);
    if (!muted && audioBlocked) void enablePrayerAudio();
  };

  useEffect(() => {
    const stored = loadJoinSession();
    if (!stored) return;
    if (user?.id && stored.asGuest) {
      void reconnectToPrayer({ silent: true });
      return;
    }
    if (connectionState !== 'DISCONNECTED' && connectionState !== 'FAILED') return;
    void reconnectToPrayer({ silent: true });
  }, [user?.id]);

  // Moderator broadcasts: live, plus the latest one from the last 30 minutes for late joiners.
  const announcementSessionId = liveSession?.id || loadJoinSession()?.sessionId || '';
  useEffect(() => {
    if (!announcementSessionId) return;
    let cancelled = false;
    sanctumApi
      .getSession(announcementSessionId)
      .then((snapshot) => {
        if (cancelled) return;
        const recent = (snapshot.chatMessages || [])
          .filter((m: any) => isBroadcastName(m.displayName))
          .filter((m: any) => Date.now() - new Date(m.createdAt || m.timestamp || 0).getTime() < 30 * 60_000)
          .pop() as any;
        if (recent) {
          setAnnouncement((current) =>
            current ?? {
              id: String(recent.id),
              body: String(recent.body),
              from: broadcastSender(String(recent.displayName)),
              at: String(recent.createdAt || recent.timestamp || ''),
            }
          );
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [announcementSessionId]);

  // Live audio relayed from the main Ka Link room (moderators start it in the Control Room).
  useEffect(() => {
    if (!announcementSessionId) return;
    let cancelled = false;
    sanctumApi
      .bridgeStatus(announcementSessionId)
      .then((result) => {
        if (!cancelled) setJordanBridge(result.bridge);
      })
      .catch(() => undefined);
    const unsubscribe = livekitRealtimeProvider.subscribe((event) => {
      if (event.type !== 'BRIDGE_CHANGED') return;
      const info = event.metadata as { active?: boolean; jordanRoomTitle?: string; speakers?: number } | undefined;
      setJordanBridge(info ? { active: info.active === true, jordanRoomTitle: info.jordanRoomTitle, speakers: info.speakers } : null);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [announcementSessionId]);

  useEffect(() => {
    return livekitRealtimeProvider.subscribe((event) => {
      if (event.type !== 'BROADCAST_MESSAGE') return;
      const body = typeof event.metadata?.body === 'string' ? event.metadata.body.trim() : '';
      if (!body) return;
      setAnnouncement({
        id: String(event.metadata?.messageId || event.timestamp),
        body,
        from: event.displayName || 'Moderator',
        at: event.timestamp,
      });
      try {
        navigator.vibrate?.(80);
      } catch {
        /* not supported */
      }
    });
  }, []);

  useEffect(() => {
    const onOnline = () => {
      void reconnectToPrayer({ silent: true });
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [reconnectToPrayer]);

  const matchedRoom =
    prayerRooms.find((item) => item.slug === roomSlug) ||
    prayerRooms.find((item) => item.id === liveSession?.prayerRoomId);
  const room = matchedRoom || prayerRooms[0];
  const leadersOnly = (matchedRoom?.speakerPermission || altarFlags?.speakerPermission) === 'PRAYER_LEADERS';
  const prayerRequestsOn = (matchedRoom?.prayerRequestsEnabled ?? altarFlags?.prayerRequestsEnabled) !== false;
  const anonymousRequestsOn = (matchedRoom?.anonymousRequestsAllowed ?? altarFlags?.anonymousRequestsAllowed) !== false;
  const chatOn = (matchedRoom?.chatEnabled ?? altarFlags?.chatEnabled) !== false;

  useEffect(() => {
    let cancelled = false;
    sanctumApi
      .getAltar(roomSlug)
      .then((result) => {
        if (!cancelled) {
          setCanControl(result.canControl === true);
          setAltarFlags(result.room);
        }
      })
      .catch(() => {
        if (!cancelled) setCanControl(false);
      });
    return () => {
      cancelled = true;
    };
  }, [roomSlug, authReady, isAuthenticated]);
  const liveConnected = connectionState === 'CONNECTED' || connectionState === 'RECONNECTING';
  const localParticipant = participants.find((item) => item.id === localParticipantId);
  const currentRole = localParticipant?.role === 'SPEAKER' ? 'SPEAKER' : 'LISTENER';
  const isInvitedSpeaker = currentRole === 'SPEAKER';
  const isMinister = isClientMinister(localParticipant?.role) || isClientMinister(user?.role);
  const congregationMuted = liveSession?.congregationMuted !== false;
  const canDiscuss = !congregationMuted && !isMinister;
  const privateWithMe =
    Boolean(liveSession?.privatePrayer) &&
    liveSession?.privatePrayer?.memberParticipantId === localParticipantId;
  const canUseMic = isMinister || isInvitedSpeaker || canDiscuss || privateWithMe;
  const showLiveMic = micOn && canUseMic;
  const prayerHasStarted = liveSession?.status === 'LIVE' || liveSession?.status === 'STARTING';
  const participantCount = liveConnected || localParticipantId ? connectedNow : undefined;
  const gatheringName = altarFlags?.name?.trim() || matchedRoom?.name || liveSession?.roomName || 'Prayer gathering';
  const sermonLeader = resolveSermonLeader(
    liveSession?.sermonLeaderName,
    altarFlags?.roomSermonLeaderName,
    altarFlags?.defaultSermonSpeaker
  );
  const floorHeld = Boolean(
    (liveSession?.activeSpeakerName || '').trim() ||
      liveSession?.pttParticipantId ||
      privateWithMe ||
      (showLiveMic && (isMinister || isInvitedSpeaker))
  );

  useEffect(() => {
    setIsHandRaised(Boolean(localParticipant?.isHandRaised));
  }, [localParticipant?.isHandRaised]);

  useEffect(() => {
    const syncLocalMic = () => {
      const status = livekitRealtimeProvider.getLocalMicStatus();
      setMicOn(status.publishing && !status.muted);
      setSelfMuted(!status.publishing || status.muted);
    };
    syncLocalMic();
    const unsubscribe = livekitRealtimeProvider.subscribe(syncLocalMic);
    const timer = window.setInterval(syncLocalMic, 1000);
    return () => {
      unsubscribe();
      window.clearInterval(timer);
    };
  }, [liveConnected]);

  useEffect(() => {
    if (!congregationMuted || isMinister || isInvitedSpeaker || privateWithMe) return;
    if (pttActive && localParticipantId) {
      setPttActive(false);
      void endPtt(localParticipantId);
    }
    if (micOn) {
      void livekitRealtimeProvider.disableMicrophone();
      setMicOn(false);
      setSelfMuted(true);
    }
  }, [congregationMuted, isMinister, isInvitedSpeaker, privateWithMe, pttActive, micOn, localParticipantId, endPtt]);

  const prevCongregationMuted = React.useRef(congregationMuted);
  useEffect(() => {
    const wasMuted = prevCongregationMuted.current;
    prevCongregationMuted.current = congregationMuted;
    if (wasMuted && !congregationMuted && !isMinister) {
      addToast('The floor is open. Hold to speak.', 'success');
    }
    if (!wasMuted && congregationMuted && !isMinister) {
      addToast('Sermon mode — congregation microphones are locked again.', 'info');
    }
  }, [congregationMuted, isMinister, addToast]);

  const handleTogglePtt = async () => {
    if (!localParticipantId || !canDiscuss || privateWithMe) return;
    if (pttActive) {
      setPttActive(false);
      await endPtt(localParticipantId);
      return;
    }
    try {
      await startPtt(localParticipantId);
      setPttActive(true);
    } catch {
      setPttActive(false);
    }
  };
  useEffect(() => {
    return livekitRealtimeProvider.subscribe((event) => {
      if (event.type !== 'PARTICIPANT_MUTED') return;
      if (event.metadata?.muted === false) return;
      if (!event.participantId || event.participantId !== localParticipantId) return;
      setMicOn(false);
      setSelfMuted(true);
      setPttActive(false);
    });
  }, [localParticipantId]);

  const handleToggleRaiseHand = async () => {
    if (!localParticipantId) return;
    if (isHandRaised) {
      await lowerHandAttendee(localParticipantId);
      setIsHandRaised(false);
    } else {
      const raised = await raiseHandAttendee(localParticipantId, participantName);
      setIsHandRaised(raised);
    }
  };

  const handleFinishPrayer = async () => {
    if (localParticipantId && currentRole === 'SPEAKER') {
      await endSpeaker(localParticipantId);
    }
    try {
      await livekitRealtimeProvider.disableMicrophone();
    } catch {
      /* already muted or disconnected */
    }
    setMicOn(false);
    setSelfMuted(true);
  };

  const handleToggleLeadMic = async () => {
    try {
      if (micOn) {
        await livekitRealtimeProvider.disableMicrophone();
        setMicOn(false);
        setSelfMuted(true);
        return;
      }
      await livekitRealtimeProvider.enableMicrophone();
      setMicOn(true);
      setSelfMuted(false);
    } catch {
      setMicOn(false);
      setSelfMuted(true);
      addToast(
        isMinister || isInvitedSpeaker
          ? 'Allow microphone access in the browser to lead in prayer.'
          : 'Allow microphone access in the browser to join the discussion.',
        'error'
      );
    }
  };

  if (prayerComplete || liveSession?.status === 'ENDED') {
    return (
      <PostPrayerSummaryView
        room={room}
        session={liveSession}
        participantName={participantName}
        onExit={onLeave}
      />
    );
  }

  const people = participants.filter((person) => !person.leftAt);
  const isLeader = (role?: string) => isClientMinister(role) || role === 'SPEAKER';
  const peopleQuery = participantQuery.trim().toLowerCase();
  const peopleShown = [...people]
    .sort(
      (a, b) =>
        Number(isClientMinister(b.role)) - Number(isClientMinister(a.role)) ||
        Number(Boolean(b.isHandRaised)) - Number(Boolean(a.isHandRaised)) ||
        a.displayName.localeCompare(b.displayName)
    )
    .filter((person) => !peopleQuery || person.displayName.toLowerCase().includes(peopleQuery));
  const peopleCount = participantCount ?? people.length;
  const speakingName = liveSession?.activeSpeakerName?.trim() || '';
  const speaking = pttActive || (showLiveMic && !selfMuted) || privateWithMe;
  const orbState: 'speaking' | 'open' | 'muted' = speaking ? 'speaking' : canUseMic && !listenOnly ? 'open' : 'muted';
  const statusLine = privateWithMe
    ? 'Private prayer with your pastor'
    : listenOnly
      ? 'Listening only'
      : speaking
        ? 'You are speaking'
        : canDiscuss
          ? 'The floor is open'
          : isMinister || isInvitedSpeaker
            ? 'Your microphone is off'
            : isHandRaised
              ? 'Hand raised — please wait'
              : 'You are Muted';
  const initials = (name: string) =>
    name.split(/\s+/).map((part) => part[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || 'M';
  const openNewTab = (url: string) => window.open(url, '_blank', 'noopener,noreferrer');
  const nav: Array<{ key: string; label: string; Icon: React.ElementType; onClick: () => void; active?: boolean }> = [
    { key: 'room', label: 'Prayer Room', Icon: Radio, active: true, onClick: () => undefined },
    { key: 'bible', label: 'Bible', Icon: BookOpen, onClick: () => openBible() },
    { key: 'rooms', label: 'All Rooms', Icon: LayoutGrid, onClick: () => openNewTab('/join') },
    ...(prayerRequestsOn ? [{ key: 'request', label: 'Prayer Request', Icon: HandHeart, onClick: () => setIsPrayerRequestOpen(true) }] : []),
    { key: 'wall', label: 'Prayer Wall', Icon: BookHeart, onClick: () => openNewTab(`${PLCC_ONE_ORIGIN}/#/community/prayer-wall`) },
    { key: 'guide', label: 'Guidelines', Icon: CircleHelp, onClick: () => setGuidelinesOpen(true) },
  ];

  const handleToggleListenOnly = async () => {
    if (listenOnly) {
      setListenOnly(false);
      return;
    }
    if (pttActive && localParticipantId) {
      setPttActive(false);
      await endPtt(localParticipantId);
    }
    if (micOn) {
      try {
        await livekitRealtimeProvider.disableMicrophone();
      } catch {
        /* already off */
      }
      setMicOn(false);
      setSelfMuted(true);
    }
    setListenOnly(true);
  };

  const handLabel = isHandRaised ? 'Lower Hand' : 'Raise Hand';
  const micControl = listenOnly ? (
    <button type="button" aria-disabled className="pr-ctl is-disabled" title="Listen only is on">
      <MicOff aria-hidden />
      <span>Unmute</span>
    </button>
  ) : (isMinister || isInvitedSpeaker) && canUseMic ? (
    <button type="button" onClick={() => void handleToggleLeadMic()} aria-pressed={micOn} data-tour="listener-mic" className={`pr-ctl ${micOn ? 'is-live' : ''}`}>
      {micOn ? <Mic aria-hidden /> : <MicOff aria-hidden />}
      <span>{micOn ? 'Mute' : 'Unmute'}</span>
    </button>
  ) : canDiscuss && !privateWithMe ? (
    <button type="button" onClick={() => void handleTogglePtt()} aria-pressed={pttActive} data-tour="listener-mic" className={`pr-ctl ${pttActive ? 'is-live' : ''}`}>
      {pttActive ? <Mic aria-hidden /> : <MicOff aria-hidden />}
      <span>{pttActive ? 'Stop' : 'Speak'}</span>
    </button>
  ) : (
    <button type="button" aria-disabled data-tour="listener-mic-locked" className="pr-ctl is-disabled" title="You can speak when a moderator approves">
      <MicOff aria-hidden />
      <span>Muted</span>
    </button>
  );

  const callControls = (
    <div className="pr-controls" data-tour="listener-reactions">
      {!leadersOnly ? (
        <button type="button" onClick={() => void handleToggleRaiseHand()} aria-pressed={isHandRaised} className={`pr-ctl is-gold ${isHandRaised ? 'is-on' : ''}`}>
          <Hand aria-hidden />
          <span>{handLabel}</span>
        </button>
      ) : (
        <button type="button" onClick={() => showSide('chat')} className="pr-ctl">
          <MessageCircle aria-hidden />
          <span>Chat</span>
        </button>
      )}
      {micControl}
      <button type="button" onClick={() => void handleToggleListenOnly()} aria-pressed={listenOnly} className={`pr-ctl ${listenOnly ? 'is-on' : ''}`}>
        <Volume2 aria-hidden />
        <span>Listen Only</span>
      </button>
      <span className="pr-ctl-gap" aria-hidden />
      <button type="button" onClick={onLeave} data-tour="listener-leave" className="pr-ctl is-leave" aria-label="Leave the overflow room">
        <LogOut aria-hidden />
        <span>Leave Room</span>
      </button>
    </div>
  );

  const openBible = () => {
    setBibleVisited(true);
    setBibleOpen(true);
  };

  return (
    <div className="pr-shell min-h-screen select-none" style={{ height: 'auto', minHeight: '100vh' }}>
      <header className="pr-header">
        <div className="pr-header-inner">
          <a href={churchSiteUrl()} className="pr-brand" aria-label="PLCC Ka Link overflow room">
            <img src="/prayer-room/prayer-emblem.png" alt="" aria-hidden className="pr-emblem" />
            <div className="min-w-0">
              <p className="pr-brand-name">PLCC KA LINK</p>
              <p className="pr-brand-sub">Overflow Room</p>
            </div>
          </a>
          <div className="pr-church">
            <p className="pr-church-name">Promised Land Christian Center</p>
            <p className="pr-church-tag">One family. Many nations. One purpose.</p>
          </div>
          <div className="pr-header-actions">
            <span data-theme="light" className="pr-desktop-only">
              <ConnectionStatus
                status={connectionStateToQuality(connectionState)}
                showLabel={false}
                preview={!liveConnected}
                live={liveConnected}
                className="sanctum-chip"
              />
            </span>
            <button type="button" onClick={() => setGuidelinesOpen(true)} className="pr-icon-btn pr-desktop-only cursor-pointer" aria-label="Guidelines">
              <CircleHelp size={22} aria-hidden />
            </button>
            {isAuthenticated ? (
              <button type="button" onClick={onLeave} className="pr-icon-btn is-solid cursor-pointer" aria-label="Back to dashboard">
                <LayoutDashboard size={20} aria-hidden />
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <div className="pr-body">
        <aside className="pr-sidebar" aria-label="Prayer room">
          <nav className="pr-nav">
            {nav.map(({ key, label, Icon, onClick, active }) => (
              <button key={key} type="button" onClick={onClick} className={`pr-nav-item cursor-pointer ${active ? 'is-active' : ''}`} aria-current={active ? 'page' : undefined}>
                <Icon size={20} aria-hidden />
                {label}
              </button>
            ))}
          </nav>
        </aside>

        <div className={`pr-content ${bibleOpen ? 'is-reading' : ''}`}>
          <main className="pr-room">
            <div className="pr-titlebar" data-tour="listener-welcome">
              <span className="pr-room-icon"><Headphones aria-hidden /></span>
              <div className="min-w-0 flex-1">
                <p className="pr-room-title">{gatheringName}</p>
                <p className="pr-room-sub">Audio Prayer Room • Overflow</p>
              </div>
              {prayerHasStarted ? (
                <span className="pr-live"><i aria-hidden /> LIVE</span>
              ) : (
                <span className="pr-live" style={{ background: '#6b7a72' }}>WAITING</span>
              )}
              <span className="pr-count" aria-label={`${peopleCount} in the room`}>
                <Users aria-hidden /> {peopleCount}
              </span>
            </div>

            {people.length ? (
              <aside className="pr-rail" aria-label={`People in the room, ${peopleCount}`}>
                <ul className="pr-rail-list">
                  {peopleShown.slice(0, 60).map((person) => {
                    const isMe = person.id === localParticipantId;
                    const prayingNow = person.role === 'SPEAKER' || (speakingName && person.displayName === speakingName);
                    const canSpeak = person.isMuted === false || person.role === 'SPEAKER';
                    return (
                      <li key={person.id}>
                        <button
                          type="button"
                          className="pr-rail-person"
                          onClick={() => showSide('people')}
                          aria-label={`${person.displayName}${isMe ? ' (you)' : ''}${isLeader(person.role) ? ', moderator' : ''}${person.isHandRaised ? ', hand raised' : ''}${canSpeak ? ', mic on' : ', muted'}`}
                        >
                          <span className={`pr-avatar ${prayingNow ? 'is-speaking' : ''} ${isLeader(person.role) ? 'is-mod' : ''}`}>
                            {initials(person.displayName)}
                            {person.isHandRaised ? <span className="pr-rail-hand" aria-hidden>✋</span> : !canSpeak ? <span className="pr-rail-muted" aria-hidden /> : null}
                          </span>
                          <span className="pr-rail-name">{isMe ? 'You' : person.displayName.split(/\s+/)[0]}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </aside>
            ) : null}

            {announcement && dismissedAnnouncement !== announcement.id ? (
              <div role="status" aria-live="polite" className="pr-announce">
                <span className="pr-info-icon" style={{ width: 36, height: 36 }}><Megaphone className="h-5 w-5" aria-hidden /></span>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-extrabold uppercase tracking-wider text-[#7a5a1c]">Message from {announcement.from}</p>
                  <p className="mt-0.5 whitespace-pre-line break-words text-sm font-semibold sm:text-base">{announcement.body}</p>
                </div>
                <button type="button" onClick={() => setDismissedAnnouncement(announcement.id)} aria-label="Dismiss message" className="shrink-0 cursor-pointer rounded-full p-1.5 hover:bg-black/10">
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </div>
            ) : null}

            {connectionState === 'RECONNECTING' ? <p className="pr-notice text-center font-semibold" role="status">Reconnecting…</p> : null}
            {(connectionState === 'FAILED' || connectionState === 'DISCONNECTED') && (localParticipantId || loadJoinSession()) ? (
              <button type="button" onClick={() => void reconnectToPrayer()} className="pr-tool mx-auto cursor-pointer">
                Reconnect
              </button>
            ) : null}
            {audioBlocked ? (
              <button type="button" onClick={() => void enablePrayerAudio()} data-tour="listener-enable-audio" className="pr-sound">
                <Volume2 className="h-5 w-5" aria-hidden />
                Tap to hear the prayer
              </button>
            ) : null}
            {privateWithMe ? (
              <p className="pr-notice is-strong text-center">
                Private prayer with your pastor — only you and the host can hear each other.
              </p>
            ) : null}

            {showLiveMic && (isMinister || isInvitedSpeaker) ? (
              <div data-theme="light">
                <SpeakerLiveView
                  participantName={participantName}
                  participantCount={participantCount}
                  selfMuted={selfMuted}
                  onToggleSelfMute={() => void handleToggleLeadMic()}
                  onFinishPrayer={handleFinishPrayer}
                />
              </div>
            ) : (
              <div className="pr-stage">
                <div className="pr-orb-row">
                  <span className={`pr-wave is-left ${floorHeld || speaking || (jordanBridge?.active && (jordanBridge.speakers || 0) > 0) ? 'is-active' : ''}`} aria-hidden>
                    {Array.from({ length: 9 }).map((_, n) => <i key={n} style={{ animationDelay: `${n * 0.11}s` }} />)}
                  </span>
                  <span className={`pr-orb ${orbState === 'open' ? 'is-open' : ''} ${orbState === 'speaking' ? 'is-open is-speaking' : ''}`}>
                    {orbState === 'muted' ? <MicOff aria-hidden /> : <Mic aria-hidden />}
                  </span>
                  <span className={`pr-wave ${floorHeld || speaking || (jordanBridge?.active && (jordanBridge.speakers || 0) > 0) ? 'is-active' : ''}`} aria-hidden>
                    {Array.from({ length: 9 }).map((_, n) => <i key={n} style={{ animationDelay: `${n * 0.11}s` }} />)}
                  </span>
                </div>
                <p className={`pr-status ${orbState !== 'muted' ? 'is-open' : ''}`}>
                  {orbState === 'muted' ? (listenOnly ? <Volume2 size={20} aria-hidden /> : <MicOff size={20} aria-hidden />) : <Mic size={20} aria-hidden />}
                  {statusLine}
                </p>
                <p className="pr-hint">
                  {floorHeld && speakingName ? (
                    <>Now praying: <strong>{speakingName}</strong></>
                  ) : jordanBridge?.active ? (
                    <>Live from Ka Link{jordanBridge.jordanRoomTitle ? ` · ${jordanBridge.jordanRoomTitle}` : ''}</>
                  ) : sermonLeader ? (
                    <>Led by {sermonLeader}</>
                  ) : congregationMuted ? (
                    'Audio only • Speak when a moderator approves'
                  ) : (
                    'Audio only • The floor is open'
                  )}
                </p>
              </div>
            )}

            {!showLiveMic ? callControls : null}

            {!showLiveMic ? (
              <div className="pr-tools" role="toolbar" aria-label="Overflow room tools">
                <button
                  ref={bibleButton}
                  type="button"
                  aria-expanded={bibleOpen}
                  aria-controls={bibleVisited ? 'sanctum-bible' : undefined}
                  onClick={() => (bibleOpen ? closeBible() : openBible())}
                  className={`pr-tool cursor-pointer ${bibleOpen ? 'is-on' : ''}`}
                >
                  <BookOpen size={17} aria-hidden /> <span>Bible</span>
                </button>
                {chatOn ? (
                  <button type="button" onClick={() => showSide('chat')} className={`pr-tool is-icon cursor-pointer ${sideTab === 'chat' ? 'is-on' : ''}`} aria-label="Room chat" title="Chat">
                    <MessageCircle size={18} aria-hidden />
                  </button>
                ) : null}
                <button type="button" onClick={() => sendReactionAttendee('AMEN')} aria-label="Say Amen" className="pr-tool cursor-pointer">
                  🙏 <span>Amen</span>
                </button>
                <button type="button" onClick={() => sendReactionAttendee('PRAISE_GOD')} aria-label="Praise God" className="pr-tool cursor-pointer">
                  ❤️ <span>Praise</span>
                </button>
                {playbackMuted ? (
                  <button type="button" onClick={togglePlayback} className="pr-tool is-on cursor-pointer">
                    <VolumeX size={17} aria-hidden /> <span>Unmute audio</span>
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setMoreOpen(true)}
                  className={`pr-tool is-icon cursor-pointer ${moreOpen ? 'is-on' : ''}`}
                  aria-label="More tools"
                  aria-haspopup="dialog"
                  aria-expanded={moreOpen}
                  title="More"
                >
                  <MoreHorizontal size={18} aria-hidden />
                </button>
              </div>
            ) : null}
          </main>

          <aside ref={sidePanel} className="pr-side" aria-label="Prayer room details">
            {bibleOpen ? (
              <div className="pr-reading-controls">
                <div className="pr-reading-summary">
                  <p className="pr-room-title">{gatheringName}</p>
                  {prayerHasStarted ? <span className="pr-live"><i aria-hidden /> LIVE</span> : null}
                  {connectionState === 'RECONNECTING' ? <span role="status" className="pr-reading-status">Reconnecting…</span> : null}
                </div>
                {!showLiveMic ? callControls : null}
              </div>
            ) : null}

            {bibleVisited ? (
              <section
                id="sanctum-bible"
                aria-labelledby="sanctum-bible-title"
                hidden={!bibleOpen}
                className="flex min-h-0 flex-1 flex-col"
                onKeyDown={(event) => {
                  if (event.key === 'Escape' && !event.defaultPrevented) {
                    event.stopPropagation();
                    closeBible();
                  }
                }}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h2 id="sanctum-bible-title" ref={bibleHeading} tabIndex={-1} className="pr-room-title flex items-center gap-2">
                    <BookOpen size={18} aria-hidden /> Bible
                  </h2>
                  <div className="flex items-center gap-1.5">
                    <button type="button" onClick={togglePlayback} aria-pressed={playbackMuted} className="pr-tool cursor-pointer">
                      {playbackMuted ? <VolumeX size={16} aria-hidden /> : <Volume2 size={16} aria-hidden />} <span>{playbackMuted ? 'Unmute' : 'Mute audio'}</span>
                    </button>
                    <button type="button" onClick={closeBible} aria-label="Close Bible" className="pr-tool is-icon cursor-pointer">
                      <X size={18} aria-hidden />
                    </button>
                  </div>
                </div>
                {audioBlocked && !playbackMuted ? (
                  <button type="button" onClick={() => void enablePrayerAudio()} className="pr-tool mb-2 cursor-pointer">Enable prayer audio</button>
                ) : null}
                <div tabIndex={0} role="region" aria-label="Bible reader" className="pr-bible">
                  <Suspense fallback={<p role="status" className="py-4">Loading Bible…</p>}>
                    <BibleReader />
                  </Suspense>
                </div>
              </section>
            ) : null}

            {!bibleOpen ? (
              <>
                <div className="pr-tabs" role="tablist">
                  <button type="button" role="tab" aria-selected={sideTab === 'people'} onClick={() => setSideTab('people')} className={`pr-tab cursor-pointer ${sideTab === 'people' ? 'is-active' : ''}`}>
                    <Users size={16} aria-hidden /> People
                  </button>
                  {chatOn ? (
                    <button type="button" role="tab" aria-selected={sideTab === 'chat'} onClick={() => setSideTab('chat')} className={`pr-tab cursor-pointer ${sideTab === 'chat' ? 'is-active' : ''}`} data-tour="listener-chat">
                      <MessageCircle size={16} aria-hidden /> Chat
                    </button>
                  ) : null}
                  <button type="button" role="tab" aria-selected={sideTab === 'info'} onClick={() => setSideTab('info')} className={`pr-tab cursor-pointer ${sideTab === 'info' ? 'is-active' : ''}`}>
                    <Info size={16} aria-hidden /> Info
                  </button>
                </div>

                {sideTab === 'chat' && chatOn ? (
                  <div data-theme="light" className="min-h-0 flex-1">
                    <PrayerChatPanel sessionId={liveSession?.id || loadJoinSession()?.sessionId} senderName={participantName} compact />
                  </div>
                ) : sideTab === 'info' ? (
                  <div className="pr-info">
                    <p className="pr-card-text">
                      Overflow prayer room for our worldwide family when the main Ka Link room is full.
                      {jordanBridge?.active ? ' You are hearing the same live prayer as the main room.' : ''}
                    </p>
                    <ul className="pr-rules">
                      <li><Headphones size={18} aria-hidden />Audio only (no video)</li>
                      <li><MicOff size={18} aria-hidden />Everyone joins muted</li>
                      {!leadersOnly ? <li><Hand size={18} aria-hidden />Use Raise Hand to request to speak</li> : null}
                      <li><ShieldCheck size={18} aria-hidden />Please keep all prayers respectful and focused</li>
                    </ul>
                    <div className="pr-info-links">
                      {nav.filter((n) => !n.active).map(({ key, label, Icon, onClick }) => (
                        <button key={key} type="button" onClick={onClick} className="pr-tool cursor-pointer">
                          <Icon size={16} aria-hidden /> {label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <>
                    <label className="pr-search">
                      <Search size={16} aria-hidden className="opacity-60" />
                      <input value={participantQuery} onChange={(e) => setParticipantQuery(e.target.value)} placeholder="Search participants…" aria-label="Search participants" />
                    </label>
                    <ul className="pr-people">
                      {peopleShown.slice(0, 120).map((person) => {
                        const isMe = person.id === localParticipantId;
                        const prayingNow = person.role === 'SPEAKER' || (speakingName && person.displayName === speakingName);
                        const canSpeak = person.isMuted === false || person.role === 'SPEAKER';
                        return (
                          <li key={person.id} className="pr-person">
                            <span className={`pr-avatar ${prayingNow ? 'is-speaking' : ''}`}>{initials(person.displayName)}</span>
                            <span className="pr-person-name">{person.displayName}{isMe ? ' (you)' : ''}</span>
                            {person.isHandRaised ? <Hand size={16} className="pr-hand" aria-label="Hand raised" /> : null}
                            {prayingNow ? (
                              <span className="pr-role is-speaking">Praying</span>
                            ) : isLeader(person.role) ? (
                              <span className="pr-role is-mod"><Crown size={12} aria-hidden /> Mod</span>
                            ) : null}
                            {canSpeak ? <Mic size={17} className="pr-mic-on" aria-label="Can speak" /> : <MicOff size={17} className="pr-mic-off" aria-label="Muted" />}
                          </li>
                        );
                      })}
                      {!peopleShown.length ? (
                        <li className="py-4 text-center text-sm text-white/60">{people.length ? 'No one matches that name.' : 'People appear here as they join.'}</li>
                      ) : null}
                    </ul>
                  </>
                )}
              </>
            ) : null}
          </aside>
        </div>
      </div>

      {moreOpen ? (
        <div className="pr-sheet-backdrop" onClick={() => setMoreOpen(false)} role="presentation">
          <div className="pr-sheet pr-more" role="dialog" aria-modal="true" aria-label="More tools" onClick={(e) => e.stopPropagation()}>
            <div className="pr-more-head">
              <p>More</p>
              <button type="button" onClick={() => setMoreOpen(false)} className="pr-more-close" aria-label="Close">
                <X size={18} aria-hidden />
              </button>
            </div>
            <div className="pr-more-grid">
              {prayerRequestsOn ? (
                <button type="button" className="pr-more-item" onClick={() => { setMoreOpen(false); setIsPrayerRequestOpen(true); }}>
                  <HandHeart size={20} aria-hidden /> <span>Prayer Request</span>
                </button>
              ) : null}
              <button type="button" className="pr-more-item" onClick={() => { setMoreOpen(false); openNewTab(`${PLCC_ONE_ORIGIN}/#/community/prayer-wall`); }}>
                <BookHeart size={20} aria-hidden /> <span>Prayer Wall</span>
              </button>
              <button type="button" className="pr-more-item" onClick={() => { setMoreOpen(false); setGuidelinesOpen(true); }}>
                <CircleHelp size={20} aria-hidden /> <span>Guidelines</span>
              </button>
              <button type="button" className="pr-more-item" onClick={() => { setMoreOpen(false); startTour(); }}>
                <GraduationCap size={20} aria-hidden /> <span>How it works</span>
              </button>
              <button type="button" className="pr-more-item" onClick={() => { setMoreOpen(false); openNewTab('/join'); }}>
                <LayoutGrid size={20} aria-hidden /> <span>All Rooms</span>
              </button>
            </div>
            {canControl && altarFlags?.id ? (
              <>
                <p className="pr-more-label">Host tools</p>
                <div className="pr-more-grid">
                  <a href={`/dashboard/prayer-rooms/${altarFlags.id}/control`} className="pr-more-item">
                    <Settings2 size={20} aria-hidden /> <span>Control room</span>
                  </a>
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      <div data-theme="light">
        <PrayerRequestModal
          isOpen={isPrayerRequestOpen && prayerRequestsOn}
          onClose={() => setIsPrayerRequestOpen(false)}
          defaultName={participantName}
          roomName={liveSession?.roomName}
          allowAnonymous={anonymousRequestsOn}
        />
        <InvitedSpeakerBanner
          isOpen={Boolean(pendingSpeakerInvite)}
          onAccept={() => void acceptSpeakerInvite()}
          onDecline={() => void declineSpeakerInvite()}
          canAccept={liveSession?.status === 'LIVE'}
        />
      </div>
      {guidelinesOpen ? <PrayerGuidelinesSheet onClose={() => setGuidelinesOpen(false)} /> : null}
    </div>
  );
};
