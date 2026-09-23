import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowLeft, BookOpen, CalendarDays, LogOut, Pencil, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import { Link, Route, Switch, useLocation } from 'wouter';

type MasterEvent = {
  id: string; title: string; event_date: string; start_time: string; status: string; seats: number | null;
  description: string; system: string; format: string; location: string; duration: string; price: string;
  experience: string; age: string; player_prep: string; recurrence: string; recurrence_until: string | null;
  archived: boolean; revision: number;
};
type FormState = Omit<MasterEvent, 'id' | 'archived' | 'revision'>;
type CatalogItem = {
  id: string; systemKey: string; title: string; description: string; imageUrl: string; age: string;
  format: string; price: string; gameType: 'campaign' | 'oneshot'; status: string; sortOrder: number;
  published: boolean; revision: number; updatedAt: string;
};
type CatalogForm = Omit<CatalogItem, 'id' | 'revision' | 'updatedAt'>;
type Session = { user: { id: string; login: string; role: string }; csrfToken?: string };
const masterDayLabels = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'];
function masterDate(value: string) { const [year, month, day] = value.split('-').map(Number); return new Date(Date.UTC(year, month - 1, day, 12)); }
function masterDateKey(value: Date) { return [value.getUTCFullYear(), String(value.getUTCMonth() + 1).padStart(2, '0'), String(value.getUTCDate()).padStart(2, '0')].join('-'); }
function masterAddDays(value: string, amount: number) { const date = masterDate(value); date.setUTCDate(date.getUTCDate() + amount); return masterDateKey(date); }
function masterStartOfWeek(value: string) { const date = masterDate(value); date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7)); return masterDateKey(date); }
function masterStartOfMonth(value: string) { const date = masterDate(value); date.setUTCDate(1); return masterDateKey(date); }
function masterOccursOn(event: MasterEvent, date: string) { if (date < event.event_date || event.archived) return false; if (event.recurrence === 'none') return date === event.event_date; if (event.recurrence_until && date > event.recurrence_until) return false; const days = Math.round((masterDate(date).getTime() - masterDate(event.event_date).getTime()) / 86400000); if (event.recurrence === 'daily') return true; if (event.recurrence === 'weekly') return days % 7 === 0; if (event.recurrence === 'biweekly') return days % 14 === 0; if (event.recurrence === 'monthly') return masterDate(date).getUTCDate() === masterDate(event.event_date).getUTCDate(); return false; }
const emptyForm: FormState = { title: '', event_date: '', start_time: '', status: 'available', seats: null, description: '', system: '', format: 'online', location: '', duration: '', price: '', experience: '', age: '18+', player_prep: '', recurrence: 'none', recurrence_until: null };
const emptyCatalogForm: CatalogForm = { systemKey: 'dnd', title: '', description: '', imageUrl: '', age: '18+', format: 'online', price: '', gameType: 'oneshot', status: '', sortOrder: 0, published: true };
const catalogSystemLabels: Record<string, string> = { dnd: 'Dungeons & Dragons', vampires: 'Вампиры: Маскарад', daggerheart: 'Daggerheart', cyberpunk: 'Cyberpunk 2020', cthulhu: 'Зов Ктулху' };
function catalogSystemLabel(value: string) { return catalogSystemLabels[value] ?? value; }
function catalogFormatLabel(value: string) {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!normalized) return 'Онлайн или очно';
  if ((normalized.includes('online') || normalized.includes('онлайн')) && (normalized.includes('offline') || normalized.includes('очно'))) return 'Онлайн и очно';
  if (normalized === 'online' || normalized === 'онлайн') return 'Онлайн';
  if (normalized === 'offline' || normalized === 'оффлайн' || normalized === 'очно' || normalized === 'офлайн') return 'Очно';
  return value.trim();
}

async function api<T>(path: string, init: RequestInit = {}) {
  const response = await fetch(path, { ...init, credentials: 'include', headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers ?? {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Не удалось выполнить запрос.');
  return data as T;
}

function LoginPage() {
  const [location, navigate] = useLocation(); const [login, setLogin] = useState(''); const [password, setPassword] = useState(''); const [error, setError] = useState(''); const [pending, setPending] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError('');
    try {
      await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ login, password }) });
      const requestedPath = location.replace(/\/+$/, '');
      const destination = requestedPath.startsWith('/master/') && requestedPath !== '/master/login' ? requestedPath : '/master/calendar';
      navigate(destination, { replace: true });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось войти.');
    } finally {
      setPending(false);
    }
  }
  return <main className="master-shell"><section className="master-login"><Link className="master-back" href="/"><ArrowLeft size={15} /> На сайт</Link><span className="eyebrow">закрытая зона мастера</span><h1>Кабинет<br /><em>Никс</em></h1><p>Здесь можно вести календарь, каталог игр и видеть заявки игроков. Публичный сайт остаётся на этом же домене.</p><form onSubmit={submit} className="master-card"><label>Логин<input value={login} onChange={(event) => setLogin(event.target.value)} autoComplete="username" required /></label><label>Пароль<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>{error && <div className="master-error" role="alert">{error}</div>}<button className="button button-primary" disabled={pending}>{pending ? 'Проверяю…' : 'Войти'}</button></form></section></main>;
}

function MasterLayout({ session, children }: { session: Session; children: React.ReactNode }) {
  const [location, navigate] = useLocation();
  const [logoutError, setLogoutError] = useState('');
  const isActive = (path: string) => location === path || location.startsWith(`${path}/`);
  async function logout() {
    setLogoutError('');
    try {
      await api('/api/auth/logout', { method: 'POST' });
      navigate('/master/login');
    } catch {
      setLogoutError('Не удалось завершить сессию. Проверьте соединение и повторите попытку.');
    }
  }
  return <main className="master-shell"><div className="master-topbar"><Link className="brand" href="/master/calendar"><span className="brand-mark">N</span><span>МАДМУАЗЕЛЬ НИКС</span></Link><div className="master-user"><span>{session.user.login}</span><button type="button" onClick={logout} aria-label="Выйти"><LogOut size={15} /></button></div></div><nav className="master-nav" aria-label="Навигация кабинета"><Link className={isActive('/master/calendar') ? 'is-active' : undefined} aria-current={isActive('/master/calendar') ? 'page' : undefined} href="/master/calendar"><CalendarDays size={15} /> Календарь</Link><Link className={isActive('/master/catalog') ? 'is-active' : undefined} aria-current={isActive('/master/catalog') ? 'page' : undefined} href="/master/catalog"><BookOpen size={15} /> Каталог</Link><Link className={isActive('/master/applications') ? 'is-active' : undefined} aria-current={isActive('/master/applications') ? 'page' : undefined} href="/master/applications">Заявки</Link><Link href="/"><ArrowLeft size={14} /> На сайт</Link></nav>{logoutError && <div className="master-error" role="alert">{logoutError}</div>}{children}</main>;
}

function useEditorDismiss(onCancel: () => void) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onCancel]);
}

function MasterOverlay({ onDismiss, children }: { onDismiss: () => void; children: React.ReactNode }) {
  return <div className="master-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onDismiss(); }}>{children}</div>;
}

function EventEditor({ event, session, onSaved, onCancel }: { event: MasterEvent | null; session: Session; onSaved: () => void; onCancel: () => void }) {
  const [form, setForm] = useState<FormState>(event ? { title: event.title, event_date: event.event_date, start_time: event.start_time, status: event.status, seats: event.seats, description: event.description, system: event.system, format: event.format, location: event.location, duration: event.duration, price: event.price, experience: event.experience, age: event.age, player_prep: event.player_prep, recurrence: event.recurrence, recurrence_until: event.recurrence_until } : emptyForm);
  const [error, setError] = useState(''); const set = (key: keyof FormState, value: string | number | null) => setForm((current) => ({ ...current, [key]: value }));
  useEditorDismiss(onCancel);
  async function submit(eventObject: FormEvent) { eventObject.preventDefault(); setError(''); const payload = { ...form, playerPrep: form.player_prep, eventDate: form.event_date, startTime: form.start_time, recurrenceUntil: form.recurrence_until, seats: form.seats === null ? null : Number(form.seats) }; try { await api(event ? `/api/master/events/${event.id}` : '/api/master/events', { method: event ? 'PATCH' : 'POST', headers: { 'X-CSRF-Token': session.csrfToken ?? '' }, body: JSON.stringify(event ? { ...payload, revision: event.revision } : payload) }); onSaved(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось сохранить игру.'); } }
  return <form className="master-editor" role="dialog" aria-modal="true" onSubmit={submit}><div className="master-editor-head"><div><span className="eyebrow">{event ? 'редактирование' : 'новая запись'}</span><h2>{event ? 'Изменить игру' : 'Добавить игру'}</h2></div><button type="button" className="master-icon-button" onClick={onCancel} aria-label="Закрыть">×</button></div><div className="master-fields"><label>Название<input value={form.title} onChange={(e) => set('title', e.target.value)} required /></label><label>Дата<input type="date" value={form.event_date} onChange={(e) => set('event_date', e.target.value)} required /></label><label>Время<input type="time" value={form.start_time} onChange={(e) => set('start_time', e.target.value)} /></label><label>Статус<select value={form.status} onChange={(e) => set('status', e.target.value)}><option value="available">Открыта</option><option value="waiting">Лист ожидания</option><option value="closed">Закрыта</option><option value="ongoing">Кампания идёт</option><option value="day_off">Выходной</option><option value="children_group">Детская группа</option><option value="open_slot">Свободный слот</option></select></label><label>Свободных мест<input type="number" min="0" value={form.seats ?? ''} onChange={(e) => set('seats', e.target.value === '' ? null : Number(e.target.value))} /></label><label>Повторение<select value={form.recurrence} onChange={(e) => set('recurrence', e.target.value)}><option value="none">Без повторения</option><option value="daily">Каждый день</option><option value="weekly">Каждую неделю</option><option value="biweekly">Раз в две недели</option><option value="monthly">Каждый месяц</option></select></label><label>Повторять до<input type="date" value={form.recurrence_until ?? ''} onChange={(e) => set('recurrence_until', e.target.value || null)} /></label><label>Система<input value={form.system} onChange={(e) => set('system', e.target.value)} placeholder="D&D 5e" /></label><label>Формат<select value={form.format} onChange={(e) => set('format', e.target.value)}><option value="online">Онлайн</option><option value="offline">Очно</option></select></label><label>Место<input value={form.location} onChange={(e) => set('location', e.target.value)} /></label><label>Цена<input value={form.price} onChange={(e) => set('price', e.target.value)} placeholder="1500 ₽" /></label><label>Возраст<input value={form.age} onChange={(e) => set('age', e.target.value)} /></label><label className="full">Описание<textarea value={form.description} onChange={(e) => set('description', e.target.value)} rows={4} /></label><label className="full">Для игроков<textarea value={form.player_prep} onChange={(e) => set('player_prep', e.target.value)} rows={3} /></label></div>{error && <div className="master-error" role="alert">{error}</div>}<div className="master-editor-actions"><button type="button" className="button button-ghost" onClick={onCancel}>Отменить</button><button className="button button-primary"><Save size={15} /> Сохранить</button></div></form>;
}

function CatalogEditor({ item, session, onSaved, onCancel }: { item: CatalogItem | null; session: Session; onSaved: () => void; onCancel: () => void }) {
  const [form, setForm] = useState<CatalogForm>(item ? {
    systemKey: item.systemKey,
    title: item.title,
    description: item.description,
    imageUrl: item.imageUrl,
    age: item.age,
    format: item.format,
    price: item.price,
    gameType: item.gameType,
    status: item.status,
    sortOrder: item.sortOrder,
    published: item.published,
  } : emptyCatalogForm);
  const [error, setError] = useState('');
  const set = <K extends keyof CatalogForm>(key: K, value: CatalogForm[K]) => setForm((current) => ({ ...current, [key]: value }));
  useEditorDismiss(onCancel);

  async function submit(eventObject: FormEvent) {
    eventObject.preventDefault();
    setError('');
    try {
      await api(item ? `/api/master/catalog/${item.id}` : '/api/master/catalog', {
        method: item ? 'PATCH' : 'POST',
        headers: { 'X-CSRF-Token': session.csrfToken ?? '' },
        body: JSON.stringify(item ? { ...form, type: form.gameType, revision: item.revision } : { ...form, type: form.gameType }),
      });
      onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось сохранить игру в каталоге.');
    }
  }

  return <form className="master-editor" role="dialog" aria-modal="true" onSubmit={submit}>
    <div className="master-editor-head"><div><span className="eyebrow">{item ? 'редактирование' : 'новая запись'}</span><h2>{item ? 'Изменить игру' : 'Добавить игру'}</h2></div><button type="button" className="master-icon-button" onClick={onCancel} aria-label="Закрыть">×</button></div>
    <div className="master-fields">
      <label>Система<select value={form.systemKey} onChange={(event) => set('systemKey', event.target.value)} required><option value="dnd">Dungeons &amp; Dragons</option><option value="vampires">Вампиры: Маскарад</option><option value="daggerheart">Daggerheart</option><option value="cyberpunk">Cyberpunk 2020</option><option value="cthulhu">Зов Ктулху</option></select></label>
      <label>Название<input value={form.title} onChange={(event) => set('title', event.target.value)} required /></label>
      <label>Тип игры<select value={form.gameType} onChange={(event) => set('gameType', event.target.value as CatalogForm['gameType'])}><option value="oneshot">Ваншот</option><option value="campaign">Кампания</option></select></label>
      <label>Возраст<input value={form.age} onChange={(event) => set('age', event.target.value)} placeholder="18+" /></label>
      <label>Формат<select value={form.format} onChange={(event) => set('format', event.target.value)}><option value="online">Онлайн</option><option value="offline">Очно</option><option value="online/offline">Онлайн и очно</option></select></label>
      <label>Цена<input value={form.price} onChange={(event) => set('price', event.target.value)} placeholder="1500 ₽" /></label>
      <label>Статус<input value={form.status} onChange={(event) => set('status', event.target.value)} placeholder="Подходит новичкам" /></label>
      <label>Порядок<input type="number" min="0" value={form.sortOrder} onChange={(event) => set('sortOrder', Number(event.target.value) || 0)} /></label>
      <label className="full">Ссылка на обложку<input type="text" inputMode="url" value={form.imageUrl} onChange={(event) => set('imageUrl', event.target.value)} placeholder="https://… или /assets/…" /></label>
      <label className="full">Описание<textarea value={form.description} onChange={(event) => set('description', event.target.value)} rows={5} /></label>
      <label className="full"><input type="checkbox" checked={form.published} onChange={(event) => set('published', event.target.checked)} /> Показывать игру в публичном каталоге</label>
    </div>
    {error && <div className="master-error" role="alert">{error}</div>}
    <div className="master-editor-actions"><button type="button" className="button button-ghost" onClick={onCancel}>Отменить</button><button className="button button-primary"><Save size={15} /> Сохранить</button></div>
  </form>;
}

function CatalogPage({ session }: { session: Session }) {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [editing, setEditing] = useState<CatalogItem | null | undefined>(undefined);
  const [error, setError] = useState('');
  const load = () => api<{ items: CatalogItem[] }>('/api/master/catalog').then((data) => setItems(data.items)).catch((reason) => setError(reason instanceof Error ? reason.message : 'Не удалось загрузить каталог.'));
  useEffect(() => { load(); }, []);

  async function remove(item: CatalogItem) {
    if (!window.confirm(`Удалить игру «${item.title}» из каталога?`)) return;
    setError('');
    try {
      await api(`/api/master/catalog/${item.id}`, { method: 'DELETE', headers: { 'X-CSRF-Token': session.csrfToken ?? '' } });
      load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось удалить игру из каталога.');
    }
  }

  return <MasterLayout session={session}>
    <section className="master-content">
      <div className="master-heading"><div><span className="eyebrow">витрина</span><h1>Каталог<br /><em>игр</em></h1></div><button className="button button-primary" onClick={() => setEditing(null)}><Plus size={16} /> Добавить игру</button></div>
      {error && <div className="master-error" role="alert">{error}</div>}
      <div className="master-events">
        {items.map((item) => <article className="master-event-card" key={item.id}>
          <div className="master-event-date"><strong>{item.gameType === 'campaign' ? 'К' : 'В'}</strong><span>{item.published ? 'опубликовано' : 'скрыто'}</span></div>
          <div className="master-event-info"><span className="master-status">{catalogSystemLabel(item.systemKey)} · {item.age || 'возраст не указан'}</span><h2>{item.title || 'Без названия'}</h2><p>{catalogFormatLabel(item.format)} · {item.price || 'Цена не указана'}{item.description ? ` · ${item.description}` : ''}</p></div>
          <div className="master-event-actions"><button type="button" onClick={() => setEditing(item)} aria-label={`Редактировать ${item.title}`}><Pencil size={15} /></button><button type="button" onClick={() => remove(item)} aria-label={`Удалить ${item.title}`}><Trash2 size={15} /></button></div>
        </article>)}
        {!items.length && <div className="master-empty">Каталог пока пуст. Добавьте первую игру.</div>}
      </div>
    </section>
    {editing !== undefined && <MasterOverlay onDismiss={() => setEditing(undefined)}><CatalogEditor item={editing} session={session} onSaved={() => { setEditing(undefined); load(); }} onCancel={() => setEditing(undefined)} /></MasterOverlay>}
  </MasterLayout>;
}

function CalendarPage({ session }: { session: Session }) {
  const [events, setEvents] = useState<MasterEvent[]>([]); const [editing, setEditing] = useState<MasterEvent | null | undefined>(undefined); const [error, setError] = useState(''); const [view, setView] = useState<'week' | 'month'>('week'); const [cursor, setCursor] = useState(() => masterStartOfWeek(new Date().toISOString().slice(0, 10)));
  const load = () => api<{ events: MasterEvent[] }>('/api/master/events').then((data) => setEvents(data.events)).catch((reason) => setError(reason instanceof Error ? reason.message : 'Не удалось загрузить календарь.'));
  useEffect(() => { load(); }, []);
  async function remove(event: MasterEvent) { if (!window.confirm(`Убрать игру «${event.title}» из календаря?`)) return; try { await api(`/api/master/events/${event.id}`, { method: 'DELETE', headers: { 'X-CSRF-Token': session.csrfToken ?? '' } }); load(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось удалить игру.'); } }
  const visibleEvents = events.filter((event) => !event.archived);
  const gridStart = view === 'week' ? cursor : masterStartOfWeek(masterStartOfMonth(cursor));
  const gridLength = view === 'week' ? 7 : 42;
  const days = useMemo(() => Array.from({ length: gridLength }, (_, index) => { const date = masterAddDays(gridStart, index); return { date, label: masterDayLabels[index % 7], events: visibleEvents.filter((event) => masterOccursOn(event, date)) }; }), [gridLength, gridStart, visibleEvents]);
  function shift(amount: number) { setCursor((current) => view === 'week' ? masterAddDays(current, amount * 7) : masterDateKey(new Date(Date.UTC(masterDate(current).getUTCFullYear(), masterDate(current).getUTCMonth() + amount, 1, 12)))); }
  return <MasterLayout session={session}><section className="master-content"><div className="master-heading"><div><span className="eyebrow">расписание</span><h1>Календарь<br /><em>игр</em></h1></div><button className="button button-primary" onClick={() => setEditing(null)}><Plus size={16} /> Добавить игру</button></div>{error && <div className="master-error">{error}</div>}<div className="master-toolbar"><span>Все записи: {visibleEvents.length}</span><div className="master-view-actions"><button type="button" className={view === 'week' ? 'is-active' : ''} onClick={() => { setView('week'); setCursor(masterStartOfWeek(cursor)); }}>Неделя</button><button type="button" className={view === 'month' ? 'is-active' : ''} onClick={() => { setView('month'); setCursor(masterStartOfMonth(cursor)); }}>Месяц</button><button type="button" onClick={() => shift(-1)} aria-label="Назад">←</button><button type="button" onClick={() => setCursor(view === 'week' ? masterStartOfWeek(new Date().toISOString().slice(0, 10)) : masterStartOfMonth(new Date().toISOString().slice(0, 10)))} aria-label="Сегодня">Сегодня</button><button type="button" onClick={() => shift(1)} aria-label="Вперёд">→</button><button type="button" onClick={load}><RefreshCw size={14} /> Обновить</button></div></div><div className="master-calendar-grid">{days.map((day) => <section className="master-calendar-day" key={day.date}><header><span>{day.label}</span><strong>{day.date.slice(8)}</strong></header><div>{day.events.map((event) => <article className="master-calendar-event" key={`${event.id}:${day.date}`}><div><b>{event.start_time || '—'}</b><strong>{event.title || 'Без названия'}</strong><small>{event.status} · {event.system || 'без системы'}</small></div><span className="master-calendar-event-actions"><button type="button" onClick={() => setEditing(event)} aria-label="Редактировать"><Pencil size={13} /></button><button type="button" onClick={() => remove(event)} aria-label="Удалить"><Trash2 size={13} /></button></span></article>)}</div></section>)}</div><div className="master-events">{events.filter((event) => !event.archived).map((event) => <article className="master-event-card" key={event.id}><div className="master-event-date"><strong>{event.event_date.slice(8)}</strong><span>{event.event_date.slice(0, 7)}</span></div><div className="master-event-info"><span className="master-status">{event.status}</span><h2>{event.title || 'Без названия'}</h2><p>{event.start_time || 'Время не указано'} · {event.system || 'Система не указана'} · {event.format || 'Формат не указан'}</p></div><div className="master-event-actions"><button type="button" onClick={() => setEditing(event)} aria-label="Редактировать"><Pencil size={15} /></button><button type="button" onClick={() => remove(event)} aria-label="Удалить"><Trash2 size={15} /></button></div></article>)}{!events.length && <div className="master-empty">Календарь пока пуст. Добавьте первую игру.</div>}</div></section>{editing !== undefined && <MasterOverlay onDismiss={() => setEditing(undefined)}><EventEditor event={editing} session={session} onSaved={() => { setEditing(undefined); load(); }} onCancel={() => setEditing(undefined)} /></MasterOverlay>}</MasterLayout>;
}

function ApplicationsPage({ session }: { session: Session }) { const [applications, setApplications] = useState<any[]>([]); useEffect(() => { api<{ applications: any[] }>('/api/master/applications').then((data) => setApplications(data.applications)).catch(() => undefined); }, []); return <MasterLayout session={session}><section className="master-content"><div className="master-heading"><div><span className="eyebrow">входящие</span><h1>Заявки<br /><em>игроков</em></h1></div></div><div className="master-applications">{applications.map((item) => <article className="master-application" key={item.id}><div><span>{new Date(item.created_at).toLocaleString('ru-RU')}</span><h2>{item.name}</h2><a href={`https://t.me/${String(item.contact).replace(/^@/, '')}`} target="_blank" rel="noreferrer">{item.contact}</a></div><p>{item.wishes || item.system || 'Без дополнительных пожеланий'}</p><strong>{item.players} игроков</strong></article>)}{!applications.length && <div className="master-empty">Новых заявок пока нет.</div>}</div></section></MasterLayout>; }

export default function MasterRoutes() {
  const [location] = useLocation();
  const [session, setSession] = useState<Session | null>(null);
  const [authPending, setAuthPending] = useState(() => location !== '/master/login');

  useEffect(() => {
    if (location === '/master/login') {
      setSession(null);
      setAuthPending(false);
      return;
    }
    if (session) return;
    let active = true;
    setAuthPending(true);
    api<Session>('/api/auth/me')
      .then((data) => { if (active) { setSession(data); setAuthPending(false); } })
      .catch(() => { if (active) { setSession(null); setAuthPending(false); } });
    return () => { active = false; };
  }, [location]);

  if (location === '/master/login') return <LoginPage />;
  if (authPending) return <main className="master-shell master-loading" role="status" aria-live="polite">Проверяем сессию…</main>;
  if (!session) return <Switch><Route path="/master/login" component={LoginPage} /><Route><LoginPage /></Route></Switch>;
  return <Switch><Route path="/master/calendar"><CalendarPage session={session} /></Route><Route path="/master/catalog"><CatalogPage session={session} /></Route><Route path="/master/applications"><ApplicationsPage session={session} /></Route><Route><CalendarPage session={session} /></Route></Switch>;
}
