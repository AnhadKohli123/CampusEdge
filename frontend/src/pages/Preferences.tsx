import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useToast } from '../components/Toast';
import { EmptyState, ErrorBanner, Spinner } from '../components/Feedback';
import { Stepper } from '../components/Stepper';
import {
  ArrowDownIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  GripIcon,
  ListIcon,
  TrashIcon,
} from '../components/Icons';
import type { Group, Hostel, Preference, RoomType } from '../lib/types';

type Choice = { hostelId: string; roomTypeId: string; hostel: string; roomType: string };

/**
 * Preference ranking. The list order *is* the rank -- the API stores the array
 * position as rank 1..N, so there is no way to submit a gap or a tie.
 *
 * Reordering works by dragging or with the arrow buttons; the buttons are not
 * a fallback but the accessible path, since HTML5 drag events are mouse-only.
 */
export function Preferences() {
  const toast = useToast();
  const [group, setGroup] = useState<Group | null>(null);
  const [hostels, setHostels] = useState<Hostel[]>([]);
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  const [choices, setChoices] = useState<Choice[]>([]);
  const [saved, setSaved] = useState<Choice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const [hostelId, setHostelId] = useState('');
  const [roomTypeId, setRoomTypeId] = useState('');
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const groupData = await api<{ group: Group | null }>('/groups/mine');
      setGroup(groupData.group);

      // Hostel blocks are single-gender, so only the group's own blocks are
      // offered -- the API would reject the others anyway.
      const hostelQuery = groupData.group?.gender
        ? `?gender=${groupData.group.gender}`
        : '';
      const [hostelData, typeData] = await Promise.all([
        api<{ hostels: Hostel[] }>(`/catalog/hostels${hostelQuery}`),
        api<{ roomTypes: RoomType[] }>('/catalog/room-types'),
      ]);
      setHostels(hostelData.hostels);
      // Only room types that fit the group's *current* size are offered -- a
      // pair cannot usefully rank a 4-seater, and the API rejects it anyway.
      const size = groupData.group?.members.length ?? 0;
      setRoomTypes(typeData.roomTypes.filter((t) => t.capacity === size));

      if (groupData.group) {
        const prefData = await api<{ preferences: Preference[] }>(
          `/groups/${groupData.group.id}/preferences`
        );
        const existing = prefData.preferences.map((p) => ({
          hostelId: p.hostel_id,
          roomTypeId: p.room_type_id,
          hostel: p.hostel_name,
          roomType: p.room_type_name,
        }));
        setChoices(existing);
        setSaved(existing);
      }
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = JSON.stringify(choices) !== JSON.stringify(saved);

  function addChoice() {
    if (!hostelId || !roomTypeId) return;
    if (choices.some((c) => c.hostelId === hostelId && c.roomTypeId === roomTypeId)) {
      toast('That combination is already on your list', 'info');
      return;
    }
    const hostel = hostels.find((h) => h.id === hostelId);
    const roomType = roomTypes.find((t) => t.id === roomTypeId);
    if (!hostel || !roomType) return;

    setChoices((prev) => [
      ...prev,
      { hostelId, roomTypeId, hostel: hostel.name, roomType: roomType.name },
    ]);
    setRoomTypeId('');
  }

  function reorder(from: number, to: number) {
    if (to < 0 || to >= choices.length || from === to) return;
    setChoices((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  async function save() {
    if (!group) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/groups/${group.id}/preferences`, {
        method: 'PUT',
        body: {
          preferences: choices.map((c) => ({
            hostelId: c.hostelId,
            roomTypeId: c.roomTypeId,
          })),
        },
      });
      setSaved(choices);
      toast(`Saved ${choices.length} preference${choices.length === 1 ? '' : 's'}`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Spinner label="Loading preferences…" />;

  if (!group) {
    return (
      <EmptyState
        icon={<ListIcon />}
        title="You are not in a group yet"
        hint="Form or join a group before ranking preferences."
        action={<Link to="/group" className="btn-primary">Go to my group</Link>}
      />
    );
  }

  if (group.status !== 'active') {
    return (
      <EmptyState
        icon={<ListIcon />}
        title="Preferences are closed"
        hint="Allotment has been run for this semester, so your ranking is locked in."
        action={<Link to="/result" className="btn-secondary">See result</Link>}
      />
    );
  }

  const size = group.members.length;

  return (
    <div className="mx-auto max-w-2xl">
      <Stepper
        current={1}
        steps={[
          { to: '/group', label: 'Form group', done: size > 0 },
          { to: '/preferences', label: 'Rank preferences', done: saved.length > 0 },
          { to: '/result', label: 'Result', done: false },
        ]}
      />

      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink-50">
          Rank your preferences
        </h1>
        <p className="mt-1.5 text-balance text-sm leading-relaxed text-ink-400">
          Highest first. The batch job walks this list in order and takes the first
          room still free, so put the one you actually want at the top.
        </p>
      </div>

      {size === 0 && (
        <div className="mb-6 rounded-md border border-amber-500/25 bg-amber-500/10 px-4 py-3">
          <p className="text-sm font-medium text-amber-200">
            Your group has no members yet
          </p>
          <p className="mt-1 text-xs text-amber-300/80">
            Add at least one before ranking rooms.
          </p>
        </div>
      )}

      <div className="space-y-5">
        <ErrorBanner error={error} />

        <section className="card">
          <h2 className="mb-4 font-medium text-ink-50">Add a choice</h2>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <select
              className="input"
              value={hostelId}
              onChange={(e) => setHostelId(e.target.value)}
              aria-label="Hostel"
            >
              <option value="">Hostel…</option>
              {hostels.map((h) => (
                <option key={h.id} value={h.id}>{h.name}</option>
              ))}
            </select>
            <select
              className="input"
              value={roomTypeId}
              onChange={(e) => setRoomTypeId(e.target.value)}
              aria-label="Room type"
            >
              <option value="">Room type…</option>
              {roomTypes.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            <button
              className="btn-secondary"
              onClick={addChoice}
              disabled={!hostelId || !roomTypeId}
            >
              Add
            </button>
          </div>
          <p className="hint">
            Your group has {size} member{size === 1 ? '' : 's'}, so only{' '}
            {size === 1 ? 'single' : `${size}-seater`} rooms in the{' '}
            {group.gender === 'female' ? "girls'" : "boys'"} blocks are listed — a
            group is allotted a room of exactly its own size. Change the group and
            this list changes with it.
          </p>
        </section>

        <section className="card">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-medium text-ink-50">Your ranking</h2>
            {choices.length > 0 && (
              <span className="text-xs text-ink-500">Drag to reorder</span>
            )}
          </div>

          {choices.length === 0 ? (
            <p className="py-8 text-center text-sm text-ink-500">
              No preferences yet. Add at least one above.
            </p>
          ) : (
            <ol className="space-y-2">
              {choices.map((choice, index) => (
                <li
                  key={`${choice.hostelId}-${choice.roomTypeId}`}
                  draggable
                  onDragStart={() => setDragIndex(index)}
                  onDragEnter={() => setOverIndex(index)}
                  onDragOver={(e) => e.preventDefault()}
                  onDragEnd={() => {
                    if (dragIndex !== null && overIndex !== null) {
                      reorder(dragIndex, overIndex);
                    }
                    setDragIndex(null);
                    setOverIndex(null);
                  }}
                  className={`flex cursor-grab items-center gap-3 rounded-md border px-3 py-2.5 transition-all duration-150 active:cursor-grabbing ${
                    dragIndex === index
                      ? 'border-accent-500/50 bg-accent-500/10 opacity-60'
                      : overIndex === index && dragIndex !== null
                        ? 'border-accent-500/40 bg-navy-800/80'
                        : 'border-navy-700 bg-navy-900/40 hover:border-navy-600'
                  }`}
                >
                  <GripIcon className="h-4 w-4 shrink-0 text-ink-600" />
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                      index === 0
                        ? 'bg-gradient-to-b from-accent-500 to-accent-600 text-white'
                        : 'bg-navy-800 text-ink-300 ring-1 ring-inset ring-navy-700'
                    }`}
                  >
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">
                    <span className="text-ink-100">{choice.hostel}</span>
                    <span className="mx-1.5 text-ink-600">·</span>
                    <span className="text-ink-400">{choice.roomType}</span>
                  </span>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <button
                      className="rounded-lg p-1.5 text-ink-500 transition-colors hover:bg-navy-800 hover:text-ink-100 disabled:opacity-25"
                      onClick={() => reorder(index, index - 1)}
                      disabled={index === 0}
                      aria-label={`Move ${choice.hostel} up`}
                    >
                      <ArrowUpIcon className="h-3.5 w-3.5" />
                    </button>
                    <button
                      className="rounded-lg p-1.5 text-ink-500 transition-colors hover:bg-navy-800 hover:text-ink-100 disabled:opacity-25"
                      onClick={() => reorder(index, index + 1)}
                      disabled={index === choices.length - 1}
                      aria-label={`Move ${choice.hostel} down`}
                    >
                      <ArrowDownIcon className="h-3.5 w-3.5" />
                    </button>
                    <button
                      className="rounded-lg p-1.5 text-ink-600 transition-colors hover:bg-rose-500/10 hover:text-rose-400"
                      onClick={() =>
                        setChoices((prev) => prev.filter((_, i) => i !== index))
                      }
                      aria-label={`Remove ${choice.hostel}`}
                    >
                      <TrashIcon className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          )}

          <div className="mt-5 flex items-center gap-3 border-t border-navy-700/70 pt-5">
            <button
              className="btn-primary"
              onClick={save}
              disabled={busy || choices.length === 0 || !dirty}
            >
              {busy ? 'Saving…' : dirty ? 'Save preferences' : 'Saved'}
            </button>
            {dirty && choices.length > 0 && (
              <span className="text-xs text-amber-300/80">Unsaved changes</span>
            )}
            {!dirty && saved.length > 0 && (
              <Link
                to="/result"
                className="ml-auto inline-flex items-center gap-1.5 text-sm text-accent-400 transition-colors hover:text-accent-300"
              >
                See result <ArrowRightIcon className="h-3.5 w-3.5" />
              </Link>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
