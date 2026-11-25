import React from 'react';
import {
  ArrowLeft,
  ArrowRight,
  DoorOpen,
  Headphones,
  Plus,
  Radio,
  Settings,
  ShieldCheck,
  Users,
  Video,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { resolveAltarLink } from '../services/altarLinkResolver';
import { JORDAN_ORIGIN, PLCC_ONE_ORIGIN } from '../lib/plccLinks';

/**
 * Moderator Control Room — the moderators' landing page (Nov 25 2026).
 *
 * Ka Link look (dark green and gold), phone first. Moderators see every overflow room at a
 * glance, then Enter one to open it and watch the count. Members never see this page:
 * Ka Link moves them into the overflow automatically when a prayer room reaches 50.
 */

interface ModeratorHomePageProps {
  onNavigate: (path: string) => void;
}

type Tone = 'live' | 'ready' | 'closed';

const STATUS: Record<string, { text: string; tone: Tone }> = {
  LIVE: { text: 'Open', tone: 'live' },
  WAITING: { text: 'Ready', tone: 'ready' },
  SCHEDULED: { text: 'Closed', tone: 'closed' },
  ENDED: { text: 'Closed', tone: 'closed' },
  NOT_FOUND: { text: 'Closed', tone: 'closed' },
};

const ORDER: Record<Tone, number> = { live: 0, ready: 1, closed: 2 };

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export const ModeratorHomePage: React.FC<ModeratorHomePageProps> = ({ onNavigate }) => {
  const { prayerRooms = [], liveSession, historySessions = [] } = useApp();
  const { user } = useAuth();
  const isAdmin = user?.role === 'OWNER' || user?.role === 'ADMIN';
  const firstName = String(user?.name || '').trim().split(/\s+/)[0];

  const rooms = (prayerRooms || [])
    .filter((room) => room && !room.isArchived)
    .map((room) => {
      const status = STATUS[resolveAltarLink(room, liveSession, historySessions).status] || STATUS.ENDED;
      const isThisOpen = liveSession?.prayerRoomId === room.id && status.tone !== 'closed';
      const people = isThisOpen ? Number(liveSession?.totalUniqueParticipants || 0) : 0;
      return { room, status, people };
    })
    .sort((a, b) => ORDER[a.status.tone] - ORDER[b.status.tone] || (a.room.name || '').localeCompare(b.room.name || ''));

  const openCount = rooms.filter((r) => r.status.tone !== 'closed').length;
  const inOverflow = rooms.reduce((sum, r) => sum + r.people, 0);
  const enter = (id: string) => onNavigate(`/dashboard/prayer-rooms/${id}/control`);
  const newRoom = () => onNavigate('/dashboard/prayer-rooms/new');

  return (
    <div className="pr-shell mcr min-h-screen">
      <header className="pr-header">
        <div className="pr-header-inner">
          <div className="pr-brand">
            <img src="/prayer-room/prayer-emblem.png" alt="" aria-hidden className="pr-emblem" />
            <div className="min-w-0 text-left">
              <p className="pr-brand-name">PLCC Ka Link</p>
              <p className="pr-brand-sub">Moderator Control Room</p>
            </div>
          </div>
          <a href={`${JORDAN_ORIGIN}/community/chat`} className="mcr-back" aria-label="Back to Ka Link">
            <ArrowLeft size={16} aria-hidden /> <span>Ka Link</span>
          </a>
        </div>
      </header>

      <main className="mcr-wrap">
        <section className="mcr-intro">
          <p className="mcr-eyebrow"><ShieldCheck size={14} aria-hidden /> Moderators</p>
          <h1 className="mcr-title">{greeting()}{firstName ? `, ${firstName}` : ''}</h1>
          <p className="mcr-lead">Open the overflow when a Ka Link prayer room nears 50 seats.</p>
        </section>

        <section className="mcr-stats" aria-label="Overview">
          <div className="mcr-stat">
            <span className="mcr-stat-icon"><DoorOpen size={18} aria-hidden /></span>
            <span className="mcr-stat-num">{rooms.length}</span>
            <span className="mcr-stat-label">Rooms</span>
          </div>
          <div className="mcr-stat">
            <span className={`mcr-stat-icon ${openCount ? 'is-live' : ''}`}><Radio size={18} aria-hidden /></span>
            <span className="mcr-stat-num">{openCount}</span>
            <span className="mcr-stat-label">Open now</span>
          </div>
          <div className="mcr-stat">
            <span className="mcr-stat-icon"><Users size={18} aria-hidden /></span>
            <span className="mcr-stat-num">{inOverflow}</span>
            <span className="mcr-stat-label">In overflow</span>
          </div>
        </section>

        <div className="mcr-grid">
          <section className="mcr-panel" aria-labelledby="mcr-rooms">
            <div className="mcr-panel-head">
              <h2 id="mcr-rooms" className="mcr-panel-title">Overflow rooms</h2>
              {isAdmin && rooms.length > 0 ? (
                <button type="button" onClick={newRoom} className="mcr-btn is-ghost is-small cursor-pointer">
                  <Plus size={16} aria-hidden /> New room
                </button>
              ) : null}
            </div>

            {rooms.length === 0 ? (
              <div className="mcr-empty">
                <span className="mcr-empty-icon"><DoorOpen size={26} aria-hidden /></span>
                <h3 className="mcr-empty-title">No overflow rooms yet</h3>
                <p className="mcr-empty-text">
                  {isAdmin
                    ? 'Create one overflow room to start. Members from a full Ka Link prayer room will be moved into it.'
                    : 'An admin needs to create an overflow room before it can be opened.'}
                </p>
                {isAdmin ? (
                  <button type="button" onClick={newRoom} className="mcr-btn is-gold cursor-pointer">
                    <Plus size={18} aria-hidden /> Create overflow room
                  </button>
                ) : null}
              </div>
            ) : (
              <ul className="mcr-rooms">
                {rooms.map(({ room, status, people }) => {
                  const audio = room.roomType === 'AUDIO_PRAYER';
                  const TypeIcon = audio ? Headphones : Video;
                  return (
                    <li key={room.id}>
                      <button type="button" onClick={() => enter(room.id)} className="mcr-room cursor-pointer" aria-label={`Enter ${room.name}`}>
                        <span className={`mcr-room-icon is-${status.tone}`} aria-hidden><TypeIcon size={20} /></span>
                        <span className="mcr-room-main">
                          <span className="mcr-room-name">{room.name}</span>
                          <span className="mcr-room-meta">
                            <span className={`mcr-pill is-${status.tone}`}>
                              {status.tone === 'live' ? <i aria-hidden /> : null}
                              {status.text}
                            </span>
                            <span>{audio ? 'Audio' : 'Audio + video'}</span>
                            {status.tone !== 'closed' ? (
                              <span className="mcr-room-count"><Users size={13} aria-hidden /> {people}</span>
                            ) : null}
                          </span>
                        </span>
                        <span className={`mcr-room-go ${status.tone === 'closed' ? '' : 'is-gold'}`}>
                          <span className="mcr-room-go-text">Enter</span> <ArrowRight size={16} aria-hidden />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <aside className="mcr-side">
            <section className="mcr-panel">
              <h2 className="mcr-panel-title">How overflow works</h2>
              <ol className="mcr-steps">
                <li>
                  <span className="mcr-step-num">1</span>
                  <div><strong>Watch the count</strong><p>Each Ka Link prayer room holds 50 members.</p></div>
                </li>
                <li>
                  <span className="mcr-step-num">2</span>
                  <div><strong>Open the overflow</strong><p>When the room is nearly full, Enter an overflow room and open it.</p></div>
                </li>
                <li>
                  <span className="mcr-step-num">3</span>
                  <div><strong>Members move in</strong><p>Ka Link moves new members in automatically. They only ever see Ka Link.</p></div>
                </li>
              </ol>
            </section>

            <section className="mcr-panel">
              <h2 className="mcr-panel-title">Quick links</h2>
              <nav className="mcr-links">
                <a href={`${JORDAN_ORIGIN}/community/chat`} className="mcr-link">
                  <Radio size={16} aria-hidden /> <span>Ka Link prayer rooms</span> <ArrowRight size={14} aria-hidden className="mcr-link-go" />
                </a>
                {isAdmin ? (
                  <>
                    <a href={`${PLCC_ONE_ORIGIN}/#/admin/ka-link-team`} target="_blank" rel="noopener noreferrer" className="mcr-link">
                      <ShieldCheck size={16} aria-hidden /> <span>Ka Link Team (Canaan)</span> <ArrowRight size={14} aria-hidden className="mcr-link-go" />
                    </a>
                    <button type="button" onClick={() => onNavigate('/dashboard/prayer-rooms/manage')} className="mcr-link cursor-pointer">
                      <Settings size={16} aria-hidden /> <span>Room settings</span> <ArrowRight size={14} aria-hidden className="mcr-link-go" />
                    </button>
                  </>
                ) : null}
              </nav>
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
};
