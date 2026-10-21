import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Clock, Search, X } from 'lucide-react';

export interface SlotTime {
  start: string;
  end: string;
  staff_id: number;
  staff_name?: string;
  available?: boolean;
}

export interface StaffChip {
  id: number;
  name: string;
}

interface TimeSlotPickerProps {
  slots: SlotTime[];
  selectedSlot: SlotTime | null;
  onSelectSlot: (slot: SlotTime) => void;
  loading: boolean;
  staff?: StaffChip[];
  selectedStaffId?: number;
  onSelectStaff?: (staffId: number) => void;
  date?: string;
  /** Store opening/closing hours, echoed by the availability endpoint. */
  businessHours?: { start: string; end: string; label: string } | null;
  /** Set when the selected day is a closed day (weekday the clinic is shut). */
  closedReason?: string | null;
}

type Meridiem = 'AM' | 'PM';

const WHEEL_ROW = 44;
const WHEEL_VISIBLE = 5;
const WHEEL_HEIGHT = WHEEL_ROW * WHEEL_VISIBLE;
const WHEEL_PAD = ((WHEEL_VISIBLE - 1) / 2) * WHEEL_ROW;

// Full free-form ranges: the wheel is never restricted to the grid so the
// picker feels open-ended. Confirm snaps the selection to the nearest real
// available slot (the server only books on its own availability grid).
const HOUR_OPTIONS = Array.from({ length: 12 }, (_, i) => String(i + 1));
const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));
const MERIDIEM_OPTIONS: Meridiem[] = ['AM', 'PM'];

function formatTime(time: string): string {
  if (!time) return '';
  const [hours, minutes] = time.split(':').map(Number);
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours % 12 || 12;
  return `${displayHour}:${String(minutes).padStart(2, '0')} ${period}`;
}

function toHour12(h24: number): number {
  return h24 % 12 || 12;
}

function meridiem(h24: number): Meridiem {
  return h24 >= 12 ? 'PM' : 'AM';
}

function toHour24(h12: number, mer: Meridiem): number {
  if (mer === 'PM') return h12 === 12 ? 12 : h12 + 12;
  return h12 === 12 ? 0 : h12;
}

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function localNow(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

interface WheelColumnProps {
  label: string;
  options: string[];
  value: string;
  onChange: (value: string) => void;
}

function WheelColumn({ label, options, value, onChange }: WheelColumnProps) {
  const ref = useRef<HTMLDivElement>(null);
  const index = options.indexOf(value);

  // Center the currently selected value. Runs on mount and whenever the value
  // changes externally (arrow keys, row clicks, opening the picker). Options
  // are constant, so a scroll never gets yanked by a shrinking list.
  useEffect(() => {
    if (ref.current && index >= 0) {
      ref.current.scrollTop = index * WHEEL_ROW;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  const handleScroll = () => {
    const el = ref.current;
    if (!el || options.length === 0) return;
    // Track the thumb live: the row closest to the center band becomes the
    // selection, so the highlight moves exactly with the scrolled list.
    const i = Math.round(el.scrollTop / WHEEL_ROW);
    const next = options[i];
    if (next !== undefined && next !== value) onChange(next);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const i = index < 0 ? 0 : Math.min(Math.max(index + (e.key === 'ArrowDown' ? 1 : -1), 0), options.length - 1);
    const next = options[i];
    if (next !== undefined) onChange(next);
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <span className="mb-1.5 text-center text-[10px] font-semibold uppercase tracking-[0.15em] text-neutral-400">
        {label}
      </span>
      <div
        ref={ref}
        onScroll={handleScroll}
        onKeyDown={handleKeyDown}
        role="listbox"
        aria-label={`${label} column`}
        tabIndex={0}
        className="relative overflow-y-auto rounded-md border border-neutral-200 outline-none scrollbar-hide snap-y snap-mandatory focus-visible:ring-2 focus-visible:ring-primary-500/30"
        style={{ height: WHEEL_HEIGHT }}
      >
        {/* Top/bottom fade masks — fixed to the viewport while the list scrolls. */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 z-20 bg-gradient-to-b from-white to-transparent"
          style={{ height: WHEEL_PAD }}
        />
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-white to-transparent"
          style={{ height: WHEEL_PAD }}
        />
        <div style={{ paddingTop: WHEEL_PAD, paddingBottom: WHEEL_PAD }}>
          {options.map((opt) => {
            const selected = opt === value;
            return (
              <button
                key={opt}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => onChange(opt)}
                className={`flex w-full select-none items-center justify-center text-sm snap-center transition-colors ${
                  selected
                    ? 'bg-primary-100 font-semibold text-[15px] text-neutral-900'
                    : 'text-neutral-400 hover:text-neutral-700'
                }`}
                style={{ height: WHEEL_ROW }}
              >
                {opt}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function TimeSlotPicker({
  slots,
  selectedSlot,
  onSelectSlot,
  loading,
  staff = [],
  selectedStaffId,
  onSelectStaff,
  date,
  businessHours = null,
  closedReason = null,
}: TimeSlotPickerProps) {
  const isPast = (start: string) => date === localToday() && start <= localNow();

  const [open, setOpen] = useState(false);
  const [staffOpen, setStaffOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLDivElement>(null);

  const [temp, setTemp] = useState<{ h12: number; mer: Meridiem; min: number } | null>(null);

  // Available (hour24, minute) tuples derived from the existing slot data.
  // Past times are excluded on today's date — same rule the grid used before.
  const availableTuples = useMemo(() => {
    const map = new Map<string, { h24: number; min: number }>();
    for (const s of slots) {
      const [h, m] = s.start.split(':').map(Number);
      if (Number.isNaN(h) || Number.isNaN(m)) continue;
      if (isPast(s.start)) continue;
      map.set(`${h}:${m}`, { h24: h, min: m });
    }
    return [...map.values()].sort((a, b) => a.h24 * 60 + a.min - (b.h24 * 60 + b.min));
  }, [slots, date]); // eslint-disable-line react-hooks/exhaustive-deps

  const tupleSet = useMemo(() => new Set(availableTuples.map((t) => `${t.h24}:${t.min}`)), [availableTuples]);

  const initTemp = useCallback(() => {
    if (selectedSlot) {
      const [h, m] = selectedSlot.start.split(':').map(Number);
      if (!Number.isNaN(h) && !Number.isNaN(m) && tupleSet.has(`${h}:${m}`)) {
        setTemp({ h12: toHour12(h), mer: meridiem(h), min: m });
        return;
      }
    }
    const first = availableTuples[0];
    if (first) {
      setTemp({ h12: toHour12(first.h24), mer: meridiem(first.h24), min: first.min });
    } else {
      setTemp(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSlot, availableTuples, tupleSet]);

  const openPicker = () => {
    initTemp();
    setOpen(true);
  };

  // Close via outside click / touch / Escape.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      const panel = timeRef.current;
      if (panel && !panel.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const selectedRow = selectedStaffId ? staff.find((s) => s.id === selectedStaffId) : null;

  // Close specialist popover via outside click / touch / Escape.
  useEffect(() => {
    if (!staffOpen) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      const panel = containerRef.current;
      if (panel && !panel.contains(e.target as Node)) setStaffOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setStaffOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [staffOpen]);

  const filteredStaff = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return staff;
    return staff.filter((s) => s.name.toLowerCase().includes(q));
  }, [staff, query]);

  const handleSelectStaff = (id: number) => {
    onSelectStaff?.(id);
    setStaffOpen(false);
    setQuery('');
  };

  const selectHour = (h12: number) => setTemp((prev) => (prev ? { ...prev, h12 } : prev));
  const selectMer = (mer: Meridiem) => setTemp((prev) => (prev ? { ...prev, mer } : prev));
  const selectMin = (min: number) => setTemp((prev) => (prev ? { ...prev, min } : prev));

  // Confirm only accepts a time that is an actual available slot — the exact
  // minute the customer picked (e.g. 12:10) is booked as-is, never re-mapped
  // to a grid time. Anything outside the store's open/available window simply
  // cannot be confirmed.

  // The actual slot matching the currently spun time, when it exists.
  const exactSlot = useMemo(() => {
    if (!temp) return null;
    const start = `${String(toHour24(temp.h12, temp.mer)).padStart(2, '0')}:${String(temp.min).padStart(2, '0')}`;
    return slots.find((s) => s.start === start) ?? null;
  }, [temp, slots]);

  // Why a spun time cannot be booked, phrased for the customer. Distinguishes a
  // closed day, an out-of-hours pick, a past time, and a genuine staff conflict
  // so the message never blames the specialist for the store being shut.
  const unavailableReason = useMemo((): string | null => {
    if (!temp) return null;
    const h24 = toHour24(temp.h12, temp.mer);
    const start = `${String(h24).padStart(2, '0')}:${String(temp.min).padStart(2, '0')}`;

    if (closedReason) return closedReason;
    if (isPast(start)) return 'This time has already passed. Please choose a later time.';

    if (businessHours?.start && businessHours?.end) {
      const toMin = (t: string) => {
        const [h, m] = t.split(':').map(Number);
        return h * 60 + m;
      };
      const pick = h24 * 60 + temp.min;
      if (pick < toMin(businessHours.start) || pick >= toMin(businessHours.end)) {
        return `We're closed at this time. Our hours are ${businessHours.label}.`;
      }
    }

    return 'This time is not available with the selected specialist. Please pick another time.';
  }, [temp, closedReason, businessHours, date]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleConfirm = () => {
    if (!exactSlot) return;
    onSelectSlot(exactSlot);
    setOpen(false);
  };

  return (
    <div className="space-y-6">
      {staff.length > 1 && (
        <div ref={containerRef} className="relative">
          <label className="label">Specialist</label>
          <button
            type="button"
            onClick={() => setStaffOpen((o) => !o)}
            aria-haspopup="listbox"
            aria-expanded={staffOpen}
            className="w-full flex items-center justify-between gap-3 rounded-md border border-neutral-200 bg-white px-3.5 py-2.5 text-left transition focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
          >
            <span className="min-w-0">
              <span className="block truncate text-sm text-neutral-900">
                {selectedRow ? selectedRow.name : 'Any available specialist'}
              </span>
              <span className="block truncate text-xs text-neutral-400">
                {selectedRow ? 'Available' : "We'll assign the least-busy available specialist"}
              </span>
            </span>
            <ChevronDown size={16} className={`flex-shrink-0 text-neutral-400 transition-transform duration-150 ${staffOpen ? 'rotate-180' : ''}`} />
          </button>

          {staffOpen && (
            <div className="absolute z-30 mt-1.5 w-full overflow-hidden rounded-md border border-neutral-200 bg-white shadow-md">
              <div className="flex items-center gap-2 border-b border-neutral-200 px-3 py-2">
                <Search size={14} className="flex-shrink-0 text-neutral-400" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search specialist..."
                  className="w-full bg-transparent text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none"
                />
              </div>
              <div role="listbox" className="max-h-60 overflow-y-auto py-1">
                <button
                  type="button"
                  role="option"
                  aria-selected={!selectedStaffId}
                  onClick={() => handleSelectStaff(0)}
                  className={`w-full flex items-start gap-2.5 px-3 py-2.5 text-left transition hover:bg-primary-50 ${
                    !selectedStaffId ? 'bg-primary-50' : ''
                  }`}
                >
                  <span
                    className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border transition ${
                      !selectedStaffId ? 'border-primary-500 bg-primary-500 text-white' : 'border-neutral-300'
                    }`}
                  >
                    {!selectedStaffId && <Check size={10} />}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-neutral-900">Any available specialist</span>
                    <span className="block truncate text-xs text-neutral-400">We'll assign the least-busy specialist</span>
                  </span>
                </button>

                {filteredStaff.map((s) => {
                  const selected = selectedStaffId === s.id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => handleSelectStaff(s.id)}
                      className={`w-full flex items-start gap-2.5 px-3 py-2.5 text-left transition hover:bg-primary-50 ${
                        selected ? 'bg-primary-50' : ''
                      }`}
                    >
                      <span
                        className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border transition ${
                          selected ? 'border-primary-500 bg-primary-500 text-white' : 'border-neutral-300'
                        }`}
                      >
                        {selected && <Check size={10} />}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-neutral-900">{s.name}</span>
                        <span className="block truncate text-xs text-neutral-400">Available</span>
                      </span>
                    </button>
                  );
                })}

                {filteredStaff.length === 0 && (
                  <p className="px-3 py-4 text-center text-xs text-neutral-400">No specialists match "{query}".</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <div ref={timeRef} className="relative">
        <label className="label">Time</label>

        {loading ? (
          <button
            type="button"
            disabled
            className="w-full flex items-center justify-between gap-3 rounded-md border border-neutral-200 bg-neutral-50 px-3.5 py-2.5 text-left text-sm text-neutral-400"
          >
            <span>Loading available times...</span>
            <ChevronDown size={16} className="flex-shrink-0 text-neutral-300" />
          </button>
        ) : availableTuples.length === 0 ? (
          <div className="py-8 text-center">
            <Clock size={28} className="mx-auto mb-2 text-neutral-300" />
            <p className="text-sm text-neutral-500">No available times for this date.</p>
            <p className="mt-1 text-xs text-neutral-400">Try selecting a different date.</p>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => (open ? setOpen(false) : openPicker())}
              aria-haspopup="dialog"
              aria-expanded={open}
              className="w-full flex items-center justify-between gap-3 rounded-md border border-neutral-200 bg-white px-3.5 py-2.5 text-left transition focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
            >
              <span className={selectedSlot ? 'truncate text-sm text-neutral-900' : 'truncate text-sm text-neutral-400'}>
                {selectedSlot ? formatTime(selectedSlot.start) : 'Select a time'}
              </span>
              <ChevronDown size={16} className={`flex-shrink-0 text-neutral-400 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
            </button>

            {open && (
              <>
                {/* Mobile scrim */}
                <div className="fixed inset-0 z-40 bg-black/30 sm:hidden" onClick={() => setOpen(false)} />

                <div
                  role="dialog"
                  aria-modal="true"
                  aria-label="Select appointment time"
                  className="fixed inset-x-0 bottom-0 z-50 rounded-t-xl border-t border-neutral-200 bg-white shadow-2xl sm:absolute sm:inset-auto sm:left-0 sm:right-0 sm:top-full sm:mt-1.5 sm:rounded-md sm:border sm:shadow-lg"
                >
                  <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3 sm:hidden">
                    <p className="text-sm font-semibold text-neutral-900">Select appointment time</p>
                    <button
                      type="button"
                      onClick={() => setOpen(false)}
                      aria-label="Cancel time selection"
                      className="p-1 rounded-md text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700"
                    >
                      <X size={18} />
                    </button>
                  </div>

                  <div className="flex gap-3 px-4 py-4 sm:px-3 sm:py-3">
                    <WheelColumn
                      label="Hour"
                      options={HOUR_OPTIONS}
                      value={temp ? String(temp.h12) : ''}
                      onChange={(v) => selectHour(Number(v))}
                    />
                    <WheelColumn
                      label="Minute"
                      options={MINUTE_OPTIONS}
                      value={temp ? String(temp.min).padStart(2, '0') : ''}
                      onChange={(v) => selectMin(Number(v))}
                    />
                    <WheelColumn
                      label="AM/PM"
                      options={MERIDIEM_OPTIONS}
                      value={temp ? temp.mer : ''}
                      onChange={(v) => selectMer(v as Meridiem)}
                    />
                  </div>

                  <div className="border-t border-neutral-100 px-4 py-2 sm:px-3">
                    <p className="text-xs text-neutral-500">
                      {temp ? (
                        exactSlot ? (
                          <>
                            <span className="font-medium text-neutral-700">{formatTime(exactSlot.start)}</span> is
                            available{exactSlot.staff_name ? ` with ${exactSlot.staff_name}` : ''}.
                          </>
                        ) : (
                          <span className="text-red-600">
                            {unavailableReason}
                          </span>
                        )
                      ) : (
                        'Choose a time.'
                      )}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 border-t border-neutral-100 px-4 py-3 sm:px-3">
                    <button
                      type="button"
                      onClick={() => setOpen(false)}
                      className="btn-secondary flex-1 justify-center"
                    >
                      <X size={15} /> Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleConfirm}
                      disabled={!exactSlot}
                      className="btn-primary flex-1 justify-center"
                    >
                      <Check size={15} /> Confirm
                    </button>
                  </div>
                </div>
              </>
            )}

            <p className="mt-3 text-xs text-neutral-400">
              {selectedSlot
                ? `${formatTime(selectedSlot.start)}${selectedSlot.staff_name ? ` with ${selectedSlot.staff_name}` : ''}.`
                : "We'll assign the least-busy available specialist for your chosen time."}
            </p>
          </>
        )}
      </div>
    </div>
  );
}