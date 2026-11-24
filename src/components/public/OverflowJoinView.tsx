import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Headphones } from 'lucide-react';
import { joinDisplayName } from '../../../shared/huddle.ts';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { JORDAN_ORIGIN, jordanRoomUrl } from '../../lib/plccLinks';
import { sanctumApi } from '../../services/api/sanctumApi';
import './overflow-join.css';

type OverflowStatus = {
  roomName: string;
  sessionId?: string;
  channelId?: string;
  ready: boolean;
  live: boolean;
};

async function getOverflow(slug: string, sourceChannel: string): Promise<OverflowStatus> {
  const { room, session } = await sanctumApi.getAltar(slug);
  const unavailable = { roomName: room.name, ready: false, live: false };
  if (!session || !['LIVE', 'WAITING', 'STARTING'].includes(session.status) || room.hasPasscode || room.allowGuests === false) {
    return unavailable;
  }

  const { bridge } = await sanctumApi.bridgeStatus(session.id);
  if (!bridge.active || !bridge.jordanChannelId || (sourceChannel && bridge.jordanChannelId !== sourceChannel)) {
    return unavailable;
  }

  return {
    roomName: bridge.jordanRoomTitle || room.name,
    sessionId: session.id,
    channelId: bridge.jordanChannelId,
    ready: true,
    live: session.status === 'LIVE' && bridge.state === 'live',
  };
}

interface OverflowJoinViewProps {
  slug: string;
  sourceChannel: string;
  onJoinSuccess: (name: string) => void;
}

export const OverflowJoinView: React.FC<OverflowJoinViewProps> = ({ slug, sourceChannel, onJoinSuccess }) => {
  const { joinPrayerRoom } = useApp();
  const { authReady, isAuthenticated, user } = useAuth();
  const [status, setStatus] = useState<OverflowStatus | null>(null);
  const [name, setName] = useState(() => localStorage.getItem('sanctum_last_attendee_name') || '');
  const [askName, setAskName] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const nameInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    let refresh: number;
    const update = async () => {
      try {
        const next = await getOverflow(slug, sourceChannel);
        if (active) setStatus(next);
      } catch {
        if (active) setStatus({ roomName: 'Prayer gathering', ready: false, live: false });
      } finally {
        if (active) refresh = window.setTimeout(update, 10_000);
      }
    };
    void update();
    return () => {
      active = false;
      window.clearTimeout(refresh);
    };
  }, [slug, sourceChannel]);

  useEffect(() => {
    if (askName) nameInput.current?.focus();
  }, [askName]);

  const join = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!status?.ready || !authReady || busy) return;
    const memberName = user?.memberName;
    const displayName = joinDisplayName({ signedIn: isAuthenticated, memberName, typedName: name });
    if (displayName.length < 2) {
      if (askName) setError('Enter at least two characters.');
      setAskName(true);
      return;
    }

    setBusy(true);
    setError('');
    try {
      const current = await getOverflow(slug, sourceChannel);
      setStatus(current);
      if (!current.ready || !current.sessionId) {
        setError('Overflow is unavailable for this gathering.');
        return;
      }
      if (!isAuthenticated || !memberName) localStorage.setItem('sanctum_last_attendee_name', displayName);
      await joinPrayerRoom(slug, displayName, { expectedSessionId: current.sessionId });
      onJoinSuccess(displayName);
    } catch {
      setError('Could not join overflow. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const backChannel = sourceChannel || status?.channelId;
  const backUrl = backChannel ? jordanRoomUrl(backChannel, false) : JORDAN_ORIGIN;
  const badge = status?.live ? 'Live' : status?.ready ? 'Starting' : status ? 'Unavailable' : 'Checking status';

  return (
    <div className="overflow-entry">
      <header className="overflow-entry-header">
        <div className="overflow-entry-brand" aria-label="PLCC Sanctum">
          <img src="/prayer-room/prayer-emblem.png" alt="" width="276" height="140" />
          <div aria-hidden="true">PLCC <strong>Sanctum</strong></div>
        </div>
        <a href={backUrl} className="overflow-entry-back"><ArrowLeft aria-hidden="true" /> Back to Ka Link</a>
      </header>

      <main className="overflow-entry-card">
        <p className="overflow-entry-status" data-live={status?.live || undefined} role="status">{badge}</p>
        <h1>{status?.roomName || 'Prayer gathering'}</h1>
        <p className="overflow-entry-subtitle">Prayer Overflow</p>
        <p className="overflow-entry-description">
          {status?.ready ? <>The main room is full.<br />{status.live ? 'Listen to the same live prayer here.' : 'You can join now and listen when the prayer audio begins.'}</>
            : status ? 'Overflow audio is unavailable for this gathering right now.' : 'Checking overflow availability…'}
        </p>
        <form onSubmit={join} className="overflow-entry-form">
          {askName ? (
            <label className="overflow-entry-name">
              Your name
              <input ref={nameInput} value={name} autoComplete="name" onChange={(event) => { setName(event.target.value); setError(''); }} required minLength={2} />
            </label>
          ) : null}
          {error ? <p className="overflow-entry-error" role="alert">{error}</p> : null}
          <button type="submit" disabled={!status?.ready || !authReady || busy}>
            <Headphones aria-hidden="true" /> {busy ? 'Joining…' : 'Join Overflow'}
          </button>
        </form>
        <p className="overflow-entry-audio"><Headphones aria-hidden="true" /> Audio only · Join muted</p>
      </main>
    </div>
  );
};
