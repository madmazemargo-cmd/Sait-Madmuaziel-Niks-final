import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Check, RefreshCw, X } from '@/components/flaticon-icons';
import './mini.css';

type TelegramWebApp = {
  initData: string;
  ready: () => void;
  expand: () => void;
  close: () => void;
  disableVerticalSwipes?: () => void;
};

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

type MiniUser = {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  timezone: string;
  notificationsEnabled: boolean;
  chatConnected: boolean;
};

type MiniTag = { slug: string; label: string };
type MiniEvent = {
  eventId: string;
  occurrenceDate: string;
  title: string;
  startTime: string;
  status: string;
  system: string;
  format: string;
  location: string;
  description: string;
  price: string;
  playerPrep: string;
  tags: MiniTag[];
  capacity: number | null;
  signupCount: number;
  waitlistCount: number;
  signupStatus: 'confirmed' | 'waitlist' | 'cancelled' | null;
  canRsvp: boolean;
};

type MiniState = {
  user: MiniUser;
  tags: string[];
  csrfToken: string;
};

function todayInMoscow() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDays(value: string, amount: number) {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + amount, 12));
  return [date.getUTCFullYear(), String(date.getUTCMonth() + 1).padStart(2, '0'), String(date.getUTCDate()).padStart(2, '0')].join('-');
}

function formatDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function statusLabel(event: MiniEvent) {
  if (event.signupStatus === 'confirmed') return 'Вы записаны';
  if (event.signupStatus === 'waitlist') return 'Вы в листе ожидания';
  if (event.status === 'waiting') return 'Набор в лист ожидания';
  if (event.capacity !== null && event.signupCount >= event.capacity) return 'Мест нет · можно в лист ожидания';
  return event.capacity === null ? 'Места уточняются' : `${Math.max(event.capacity - event.signupCount, 0)} мест свободно`;
}

function formatEventDetails(event: MiniEvent) {
  return [event.startTime, event.format === 'offline' ? event.location || 'Очно' : event.format === 'online' ? 'Онлайн' : event.location, event.system, event.price].filter(Boolean).join(' · ');
}

async function api<T>(path: string, init: RequestInit = {}) {
  const response = await fetch(path, { ...init, credentials: 'include', cache: 'no-store', headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers ?? {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Не удалось выполнить запрос.');
  return data as T;
}

function MiniGate({ reason }: { reason?: string }) {
  const botUrl = (import.meta.env.VITE_TELEGRAM_BOT_URL as string | undefined) || 'https://t.me/mad_maze_elle';
  return <main className="mini-app"><section className="mini-gate"><div className="mini-gate-mark">N</div><span className="mini-kicker">ассистент мастера</span><h1>Мадмуазель<br /><em>Никс</em></h1><p>{reason || 'Откройте мини‑апп из Telegram, чтобы записаться на игру и получать напоминания.'}</p><a className="mini-primary" href={botUrl} target="_blank" rel="noreferrer">Открыть Telegram</a></section></main>;
}

function EventCard({ event, pending, onRsvp }: { event: MiniEvent; pending: boolean; onRsvp: (event: MiniEvent) => void }) {
  const isActive = event.signupStatus === 'confirmed' || event.signupStatus === 'waitlist';
  const isClosed = !['available', 'waiting'].includes(event.status);
  const buttonLabel = isActive ? 'Не смогу' : event.status === 'waiting' || (event.capacity !== null && event.signupCount >= event.capacity) ? 'В лист ожидания' : 'Я иду';
  return <article className={`mini-event ${isActive ? 'is-joined' : ''}`}>
    <div className="mini-event-date"><strong>{event.occurrenceDate.slice(8)}</strong><span>{formatDate(event.occurrenceDate).split(' ')[0]}</span></div>
    <div className="mini-event-body"><div className="mini-event-head"><div><span className="mini-event-meta">{formatEventDetails(event)}</span><h2>{event.title}</h2></div>{isActive && <span className="mini-check" aria-label={statusLabel(event)}><Check size={14} /></span>}</div>
      <p className="mini-event-status">{statusLabel(event)}</p>
      {event.tags.length > 0 && <div className="mini-tags">{event.tags.map((tag) => <span key={tag.slug}>{tag.label}</span>)}</div>}
      {event.description && <p className="mini-event-description">{event.description}</p>}
      {(isActive || !isClosed) && <button type="button" className={isActive ? 'mini-secondary' : 'mini-primary'} onClick={() => onRsvp(event)} disabled={pending}>{pending ? 'Сохраняю…' : buttonLabel}</button>}
    </div>
  </article>;
}

export default function MiniApp() {
  const [state, setState] = useState<MiniState | null>(null);
  const [events, setEvents] = useState<MiniEvent[]>([]);
  const [allTags, setAllTags] = useState<MiniTag[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tab, setTab] = useState<'upcoming' | 'games' | 'settings'>('upcoming');
  const [filter, setFilter] = useState('');
  const [pendingId, setPendingId] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [error, setError] = useState('');

  const webApp = typeof window !== 'undefined' ? window.Telegram?.WebApp : undefined;

  async function loadEvents(nextTab = tab, nextFilter = filter) {
    if (!state) return;
    const today = todayInMoscow();
    const path = nextTab === 'games' ? `/api/mini/games${nextFilter ? `?tag=${encodeURIComponent(nextFilter)}` : ''}` : `/api/mini/events?from=${today}&to=${addDays(today, 30)}${nextFilter ? `&tag=${encodeURIComponent(nextFilter)}` : ''}`;
    const payload = await api<{ events: MiniEvent[] }>(path);
    setEvents(payload.events);
  }

  useEffect(() => {
    if (!webApp || !webApp.initData) {
      setLoading(false);
      return;
    }
    webApp.ready();
    webApp.expand();
    webApp.disableVerticalSwipes?.();
    let active = true;
    (async () => {
      try {
        const session = await api<{ csrfToken: string; user: MiniUser; tags?: string[] }>('/api/mini/session', { method: 'POST', body: JSON.stringify({ initData: webApp.initData }) });
        if (!active) return;
        setState({ csrfToken: session.csrfToken, user: session.user, tags: session.tags ?? [] });
        setSelectedTags(session.tags ?? []);
        const [tags, upcoming] = await Promise.all([
          api<{ tags: MiniTag[]; selected: string[] }>('/api/mini/tags'),
          api<{ events: MiniEvent[] }>(`/api/mini/events?from=${todayInMoscow()}&to=${addDays(todayInMoscow(), 30)}`),
        ]);
        if (!active) return;
        setAllTags(tags.tags);
        setSelectedTags(tags.selected);
        setEvents(upcoming.events);
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : 'Не удалось открыть мини‑апп.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const displayedEvents = useMemo(() => events, [events]);

  async function rsvp(event: MiniEvent) {
    if (!state) return;
    setPendingId(`${event.eventId}:${event.occurrenceDate}`);
    setError('');
    try {
      const action = event.signupStatus === 'confirmed' || event.signupStatus === 'waitlist' ? 'cancel' : 'join';
      await api('/api/mini/rsvp', { method: 'POST', headers: { 'X-CSRF-Token': state.csrfToken }, body: JSON.stringify({ eventId: event.eventId, occurrenceDate: event.occurrenceDate, action }) });
      await loadEvents();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось изменить запись.');
    } finally {
      setPendingId('');
    }
  }

  async function changeTab(nextTab: 'upcoming' | 'games' | 'settings') {
    setTab(nextTab);
    if (nextTab === 'games') setFilter('');
    if (nextTab !== 'settings') {
      try { await loadEvents(nextTab, nextTab === 'upcoming' ? filter : ''); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось загрузить игры.'); }
    }
  }

  async function saveSettings() {
    if (!state) return;
    setSavingSettings(true);
    setError('');
    try {
      const payload = await api<{ user: MiniUser; tags: string[] }>('/api/mini/me', { method: 'PATCH', headers: { 'X-CSRF-Token': state.csrfToken }, body: JSON.stringify({ tags: selectedTags, notificationsEnabled: state.user.notificationsEnabled }) });
      setState((current) => current ? { ...current, user: payload.user, tags: payload.tags } : current);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось сохранить настройки.');
    } finally {
      setSavingSettings(false);
    }
  }

  if (!webApp || !webApp.initData) return <MiniGate />;
  if (loading) return <main className="mini-app"><div className="mini-loading">Открываю приложение…</div></main>;
  if (error && !state) return <MiniGate reason={error} />;
  if (!state) return <MiniGate />;

  return <main className="mini-app">
    <header className="mini-header"><div><span className="mini-kicker">ассистент мастера</span><h1>Привет, {state.user.firstName || 'игрок'} <span>✦</span></h1></div><button type="button" className="mini-refresh" onClick={() => loadEvents()} aria-label="Обновить"><RefreshCw size={16} /></button></header>
    {!state.user.chatConnected && <div className="mini-notice">Нажмите /start в чате бота, чтобы получать напоминания.</div>}
    {error && <div className="mini-error" role="alert">{error}<button type="button" onClick={() => setError('')} aria-label="Закрыть"><X size={14} /></button></div>}
    {tab !== 'settings' && <div className="mini-filter-row"><button type="button" className={!filter ? 'mini-chip is-active' : 'mini-chip'} onClick={() => { setFilter(''); loadEvents(tab, ''); }}>Все игры</button>{allTags.map((tag) => <button type="button" className={filter === tag.slug ? 'mini-chip is-active' : 'mini-chip'} key={tag.slug} onClick={() => { setFilter(tag.slug); loadEvents(tab, tag.slug); }}>{tag.label}</button>)}</div>}
    <section className="mini-content" aria-live="polite">
      {tab === 'settings' ? <div className="mini-settings"><div className="mini-section-title"><span className="mini-kicker">профиль</span><h2>Настройки</h2></div><div className="mini-setting-card"><div><strong>Напоминания</strong><p>{state.user.chatConnected ? 'Сообщения о ваших играх и выбранных тегах' : 'Сначала запустите бота командой /start'}</p></div><button type="button" className={`mini-switch ${state.user.notificationsEnabled ? 'is-on' : ''}`} aria-label={state.user.notificationsEnabled ? 'Выключить напоминания' : 'Включить напоминания'} aria-pressed={state.user.notificationsEnabled} onClick={() => setState((current) => current ? { ...current, user: { ...current.user, notificationsEnabled: !current.user.notificationsEnabled } } : current)}><span /></button></div><div className="mini-section-title"><span className="mini-kicker">интересы</span><h2>Теги</h2><p>Выберите темы, о которых присылать новости.</p></div><div className="mini-tag-picker">{allTags.length ? allTags.map((tag) => <button type="button" key={tag.slug} className={selectedTags.includes(tag.slug) ? 'mini-chip is-active' : 'mini-chip'} onClick={() => setSelectedTags((current) => current.includes(tag.slug) ? current.filter((item) => item !== tag.slug) : [...current, tag.slug])}>{tag.label}</button>) : <p className="mini-muted">Теги появятся, когда мастер добавит их к игре.</p>}</div><button type="button" className="mini-primary mini-save" onClick={saveSettings} disabled={savingSettings}>{savingSettings ? 'Сохраняю…' : 'Сохранить настройки'}</button></div> : <>{displayedEvents.length ? displayedEvents.map((event) => <EventCard event={event} pending={pendingId === `${event.eventId}:${event.occurrenceDate}`} onRsvp={rsvp} key={`${event.eventId}:${event.occurrenceDate}`} />) : <div className="mini-empty"><CalendarDays size={22} /><h2>{tab === 'games' ? 'Пока нет записей' : 'Ближайших игр нет'}</h2><p>{tab === 'games' ? 'Выберите игру во вкладке «Ближайшие».' : 'Загляните позже или выберите другой тег.'}</p></div>}</>}
    </section>
    <nav className="mini-tabs" aria-label="Разделы приложения"><button type="button" className={tab === 'upcoming' ? 'is-active' : ''} onClick={() => changeTab('upcoming')}><CalendarDays size={16} /><span>Ближайшие</span></button><button type="button" className={tab === 'games' ? 'is-active' : ''} onClick={() => changeTab('games')}><Check size={16} /><span>Мои игры</span></button><button type="button" className={tab === 'settings' ? 'is-active' : ''} onClick={() => changeTab('settings')}><span className="mini-tab-dot">●</span><span>Настройки</span></button></nav>
  </main>;
}
