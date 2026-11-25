import React from 'react';
import { ChevronRight, Radio, Settings, Users } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { resolveAltarLink } from '../services/altarLinkResolver';
import { JORDAN_ORIGIN } from '../lib/plccLinks';

/**
 * Moderator Control Room — the moderators' landing page (Nov 25 2026).
 *
 * Same look as Ka Link (dark green and gold, Ka Link header). Moderators pick a
 * prayer room, open its overflow and watch the count from inside the Moderator Room.
 * Members never see this page: Ka Link moves them into the overflow automatically.
 * Admins still reach the full room settings from the small link at the bottom.
 */

interface ModeratorHomePageProps {
  onNavigate: (path: string) => void;
}

const STATUS_LABEL: Record<string, { text: string; tone: 'live' | 'wait' | 'off' }> = {
  LIVE: { text: 'Overflow open', tone: 'live' },
  WAITING: { text: 'Ready to start', tone: 'wait' },
  SCHEDULED: { text: 'Closed', tone: 'off' },
  ENDED: { text: 'Closed', tone: 'off' },
  NOT_FOUND: { text: 'Closed', tone: 'off' },
};

export const ModeratorHomePage: React.FC<ModeratorHomePageProps> = ({ onNavigate }) => {
  const { prayerRooms = [], liveSession, historySessions = [] } = useApp();
  const { user } = useAuth();
  const isAdmin = user?.role === 'OWNER' || user?.role === 'ADMIN';

  const rooms = (prayerRooms || []).filter((room) => room && !room.isArchived);
  const firstName = String(user?.name || '').trim().split(/\s+/)[0];

  return (
    <div className="pr-shell mod-home min-h-screen">
      <header className="pr-header">
        <div className="pr-header-inner">
          <a href={`${JORDAN_ORIGIN}/community/chat`} className="pr-brand" aria-label="Back to Ka Link">
            <img src="/prayer-room/prayer-emblem.png" alt="" aria-hidden className="pr-emblem" />
            <div className="min-w-0 text-left">
              <p className="pr-brand-name">PLCC Ka Link</p>
              <p className="pr-brand-sub">Moderator Control Room</p>
            </div>
          </a>
        </div>
      </header>

      <main className="mod-home-body">
        <h1 className="mod-home-title">{firstName ? `Welcome, ${firstName}` : 'Welcome, moderator'}</h1>

        <ol className="mod-home-steps" aria-label="During a gathering">
          <li><span>1</span> Watch the Ka Link room count. Rooms hold 50.</li>
          <li><span>2</span> When it is nearly full, open the overflow room below.</li>
          <li><span>3</span> Members are moved in automatically. They only ever see Ka Link.</li>
        </ol>

        <h2 className="mod-home-label">Prayer rooms</h2>
        {rooms.length === 0 ? (
          <p className="mod-home-empty">No prayer rooms yet. Ask an admin to set them up.</p>
        ) : (
          <ul className="mod-home-list">
            {rooms.map((room) => {
              const status = resolveAltarLink(room, liveSession, historySessions).status;
              const label = STATUS_LABEL[status] || STATUS_LABEL.ENDED;
              const isThisLive = liveSession?.prayerRoomId === room.id && status === 'LIVE';
              const count = isThisLive ? Number(liveSession?.totalUniqueParticipants || 0) : 0;
              return (
                <li key={room.id}>
                  <button
                    type="button"
                    onClick={() => onNavigate(`/dashboard/prayer-rooms/${room.id}/control`)}
                    className="mod-home-room cursor-pointer"
                  >
                    <span className="mod-home-room-icon" aria-hidden><Radio size={20} /></span>
                    <span className="mod-home-room-main">
                      <span className="mod-home-room-name">{room.name}</span>
                      <span className={`mod-home-chip is-${label.tone}`}>
                        {label.tone === 'live' ? <i aria-hidden /> : null}
                        {label.text}
                        {isThisLive ? <><Users size={12} aria-hidden /> {count}</> : null}
                      </span>
                    </span>
                    <span className="mod-home-go">Enter <ChevronRight size={18} aria-hidden /></span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {isAdmin ? (
          <button type="button" onClick={() => onNavigate('/dashboard/prayer-rooms/manage')} className="mod-home-admin cursor-pointer">
            <Settings size={16} aria-hidden /> Room settings (admins)
          </button>
        ) : null}
      </main>
    </div>
  );
};
