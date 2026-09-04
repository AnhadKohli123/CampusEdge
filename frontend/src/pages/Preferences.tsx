import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { EmptyState, ErrorBanner, Spinner } from '../components/Feedback';
import type { Group, Hostel, Preference, RoomType } from '../lib/types';

const GROUP_SIZE = 4;

type Choice = { hostelId: string; roomTypeId: string; label: string };

/**
 * Preference ranking. The list order *is* the rank -- reordering here is what
 * the API stores as rank 1..N, so there is no way to submit a gap or a tie.
 */
export function Preferences() {
  const [group, setGroup] = useState<Group | null>(null);
  const [hostels, setHostels] = useState<Hostel[]>([]);
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  const [choices, setChoices] = useState<Choice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const [hostelId, setHostelId] = useState('');
  const [roomTypeId, setRoomTypeId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [groupData, hostelData, typeData] = await Promise.all([
        api<{ group: Group | null }>('/groups/mine'),
        api<{ hostels: Hostel[] }>('/catalog/hostels'),
        api<{ roomTypes: RoomType[] }>('/catalog/room-types'),
      ]);
      setGroup(groupData.group);
      setHostels(hostelData.hostels);
      // Only room types that can actually hold the group are offered, so a
      // student cannot rank something the algorithm would never match.
      setRoomTypes(typeData.roomTypes.filter((t) => t.capacity === GROUP_SIZE));

      if (groupData.group) {
        const prefData = await api<{ preferences: Preference[] }>(
          `/groups/${groupData.group.id}/preferences`
        );
        setChoices(
          prefData.preferences.map((p) => ({
            hostelId: p.hostel_id,
            roomTypeId: p.room_type_id,
            label: `${p.hostel_name} · ${p.room_type_name}`,
          }))
        );
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

  function addChoice() {
    if (!hostelId || !roomTypeId) return;
    const exists = choices.some(
      (c) => c.hostelId === hostelId && c.roomTypeId === roomTypeId
    );
    if (exists) return;

    const hostel = hostels.find((h) => h.id === hostelId);
    const roomType = roomTypes.find((t) => t.id === roomTypeId);
    if (!hostel || !roomType) return;

    setChoices((prev) => [
      ...prev,
      { hostelId, roomTypeId, label: `${hostel.name} · ${roomType.name}` },
    ]);
    setSaved(false);
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= choices.length) return;
    setChoices((prev) => {
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setSaved(false);
  }

  function remove(index: number) {
    setChoices((prev) => prev.filter((_, i) => i !== index));
    setSaved(false);
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
      setSaved(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Spinner />;

  if (!group) {
    return (
      <EmptyState
        title="You are not in a group yet"
        hint="Form or join a group before ranking preferences."
      />
    );
  }

  if (group.status === 'allotted') {
    return (
      <EmptyState
        title="Preferences are locked"
        hint="Your group already has a room. Ask a caretaker if you need a swap."
      />
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Rank your preferences</h1>
        <p className="mt-1 text-sm text-slate-500">
          Highest first. The batch job walks this list in order and takes the first
          room still free.
        </p>
      </div>

      <ErrorBanner error={error} />

      <section className="card space-y-4">
        <h2 className="font-medium">Add a choice</h2>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <select className="input" value={hostelId} onChange={(e) => setHostelId(e.target.value)}>
            <option value="">Hostel…</option>
            {hostels.map((h) => (
              <option key={h.id} value={h.id}>{h.name}</option>
            ))}
          </select>
          <select
            className="input"
            value={roomTypeId}
            onChange={(e) => setRoomTypeId(e.target.value)}
          >
            <option value="">Room type…</option>
            {roomTypes.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <button className="btn-secondary" onClick={addChoice} disabled={!hostelId || !roomTypeId}>
            Add
          </button>
        </div>
        <p className="text-xs text-slate-500">
          Only {GROUP_SIZE}-capacity room types are listed — a group of {GROUP_SIZE} is
          allotted a room of exactly that size.
        </p>
      </section>

      <section className="card">
        <h2 className="mb-4 font-medium">Your ranking</h2>
        {choices.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">
            No preferences yet. Add at least one.
          </p>
        ) : (
          <ol className="space-y-2">
            {choices.map((choice, index) => (
              <li
                key={`${choice.hostelId}-${choice.roomTypeId}`}
                className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-medium text-brand-700">
                  {index + 1}
                </span>
                <span className="flex-1 text-sm">{choice.label}</span>
                <button
                  className="rounded px-2 py-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  aria-label="Move up"
                >
                  ↑
                </button>
                <button
                  className="rounded px-2 py-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                  onClick={() => move(index, 1)}
                  disabled={index === choices.length - 1}
                  aria-label="Move down"
                >
                  ↓
                </button>
                <button
                  className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                  onClick={() => remove(index)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ol>
        )}

        <div className="mt-5 flex items-center gap-3 border-t border-slate-100 pt-5">
          <button className="btn-primary" onClick={save} disabled={busy || choices.length === 0}>
            {busy ? 'Saving…' : 'Save preferences'}
          </button>
          {saved && <span className="text-sm text-green-700">Saved.</span>}
        </div>
      </section>
    </div>
  );
}
