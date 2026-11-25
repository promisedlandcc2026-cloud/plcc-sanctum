import React, { useEffect, useMemo, useState } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import type { PrayerRoom } from '../../types';

/**
 * One-step overflow setup (Nov 25 2026). Tick the Ka Link prayer rooms that need an
 * overflow room, tap Create. Every setting that makes overflow work is filled in:
 * corporate prayer, audio only (light on mobile data), guests allowed, no passcode,
 * link made from the name. The full form stays under Room settings for admins.
 */

export const OVERFLOW_GATHERINGS = [
  { key: 'morning-glory', name: 'Morning Glory', blurb: 'Start the day in prayer together.', start: '05:00 AM' },
  { key: 'lunch-hour', name: 'Lunch Hour', blurb: 'A midday pause to pray.', start: '01:00 PM' },
  { key: 'midnight-watch', name: 'Midnight Watch', blurb: 'Watching and praying through the night.', start: '12:00 AM' },
  { key: 'upper-room', name: 'Upper Room', blurb: 'Waiting on the Lord together.', start: '07:00 PM' },
  { key: 'intercessors', name: 'Intercessors', blurb: 'Standing in the gap for the church.', start: '08:00 PM' },
] as const;

type Gathering = (typeof OVERFLOW_GATHERINGS)[number];

const norm = (s: string | null | undefined) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** The overflow room already made for this gathering, if any. */
export function overflowRoomFor(g: Gathering, rooms: PrayerRoom[]): PrayerRoom | undefined {
  return rooms.find((r) => !r.isArchived && (r.slug === `${g.key}-overflow` || norm(r.name).startsWith(norm(g.name))));
}

interface OverflowSetupSheetProps {
  open: boolean;
  onClose: () => void;
}

export const OverflowSetupSheet: React.FC<OverflowSetupSheetProps> = ({ open, onClose }) => {
  const { prayerRooms = [], createPrayerRoom, addToast } = useApp();
  const { organization } = useAuth();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const existing = useMemo(
    () => new Set(OVERFLOW_GATHERINGS.filter((g) => overflowRoomFor(g, prayerRooms)).map((g) => g.key as string)),
    [prayerRooms]
  );
  const available = OVERFLOW_GATHERINGS.filter((g) => !existing.has(g.key));
  const allPicked = available.length > 0 && available.every((g) => picked.has(g.key));

  // Start with every room that still needs one ticked: the common case is "all of them".
  useEffect(() => {
    if (open) setPicked(new Set(available.map((g) => g.key)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  const toggle = (key: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  const create = async () => {
    const chosen = available.filter((g) => picked.has(g.key));
    if (!chosen.length || busy) return;
    setBusy(true);
    let made = 0;
    try {
      for (const g of chosen) {
        await createPrayerRoom({
          organizationId: organization.id,
          name: `${g.name} Overflow`,
          slug: `${g.key}-overflow`,
          description: `Overflow for the Ka Link ${g.name} prayer room. ${g.blurb}`,
          roomType: 'AUDIO_PRAYER',
          expectedAttendance: 5000,
          isRecurring: true,
          recurrenceRule: 'DAILY',
          selectedDays: [],
          oneTimeDate: null,
          durationMinutes: 180,
          scheduledStart: g.start,
          timezone: organization.timezone || 'Africa/Kampala',
          speakerPermission: 'ADMIN_APPROVAL_REQUIRED',
          recordingEnabled: false,
          sermonLeaderUserId: null,
          coHostUserIds: [],
          allowGuests: true,
          prayerRequestsEnabled: true,
          anonymousRequestsAllowed: true,
          chatEnabled: true,
          permanentUrl: `/join/${g.key}-overflow`,
          status: 'SCHEDULED',
        } as Parameters<typeof createPrayerRoom>[0]);
        made += 1;
      }
      addToast(made === 1 ? 'Overflow room created' : `${made} overflow rooms created`, 'success');
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Something went wrong.';
      addToast(made ? `${made} created. Then: ${msg}` : msg, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ovs-backdrop" role="presentation" onClick={() => !busy && onClose()}>
      <div className="ovs-sheet" role="dialog" aria-modal="true" aria-labelledby="ovs-title" onClick={(e) => e.stopPropagation()}>
        <span className="ovs-grab" aria-hidden />
        <div className="ovs-head">
          <div>
            <h2 id="ovs-title" className="ovs-title">Set up overflow rooms</h2>
            <p className="ovs-sub">Choose the Ka Link prayer rooms that need an overflow.</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="ovs-close cursor-pointer" aria-label="Close">
            <X size={20} aria-hidden />
          </button>
        </div>

        {available.length > 1 ? (
          <button
            type="button"
            className="ovs-all cursor-pointer"
            onClick={() => setPicked(allPicked ? new Set() : new Set(available.map((g) => g.key)))}
          >
            {allPicked ? 'Clear all' : 'Select all'}
          </button>
        ) : null}

        <ul className="ovs-list">
          {OVERFLOW_GATHERINGS.map((g) => {
            const done = existing.has(g.key);
            const on = picked.has(g.key);
            return (
              <li key={g.key}>
                <button
                  type="button"
                  disabled={done || busy}
                  onClick={() => toggle(g.key)}
                  aria-pressed={done ? undefined : on}
                  className={`ovs-item cursor-pointer ${on && !done ? 'is-on' : ''} ${done ? 'is-done' : ''}`}
                >
                  <span className="ovs-check" aria-hidden>{done || on ? <Check size={16} strokeWidth={3} /> : null}</span>
                  <span className="ovs-item-main">
                    <span className="ovs-item-name">{g.name}</span>
                    <span className="ovs-item-blurb">{done ? 'Overflow room ready' : g.blurb}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <p className="ovs-note">Audio only · guests welcome · no passcode. Members from Ka Link get straight in.</p>

        {available.length === 0 ? (
          <button type="button" onClick={onClose} className="mcr-btn is-gold ovs-cta cursor-pointer">All set — close</button>
        ) : (
          <button type="button" onClick={create} disabled={!picked.size || busy} className="mcr-btn is-gold ovs-cta cursor-pointer">
            {busy ? <><Loader2 size={18} className="animate-spin" aria-hidden /> Creating…</> : picked.size > 1 ? `Create ${picked.size} overflow rooms` : picked.size === 1 ? 'Create overflow room' : 'Choose a prayer room'}
          </button>
        )}
      </div>
    </div>
  );
};
