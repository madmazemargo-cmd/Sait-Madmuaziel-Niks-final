import { useEffect, useMemo, useState, type AnchorHTMLAttributes, type FormEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Check, Menu, X } from '@/components/flaticon-icons';
import { Link, Route, Switch, Router as WouterRouter, useLocation, useSearch } from 'wouter';
import {
  useGetApplicationSelection,
  useGetCalendar,
  useSubmitApplication,
  type ApplicationInput,
  type CalendarEvent,
  type GameSelection,
} from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import MasterRoutes from '@/master';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 0,
      refetchOnMount: true,
      refetchOnWindowFocus: true,
    },
  },
});

type Game = {
  id: string;
  eventId: string;
  title: string;
  system: string;
  dateISO: string;
  date: string;
  time: string;
  place: string;
  price: string;
  spots: string;
  image: string;
  description: string;
  status: string;
  seats: number | null;
  format: string;
  storyType: 'campaign' | 'oneshot';
  experience: string;
};

const calendarOnlyStatuses = new Set(['day_off', 'children_group', 'open_slot']);
const weekDayLabels = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'];

function storyTypeForEvent(event: CalendarEvent): 'campaign' | 'oneshot' {
  const source = `${event.title} ${event.description} ${event.duration}`.toLowerCase();
  return event.status === 'ongoing' || source.includes('кампан') || source.includes('серия') || source.includes('сезон') ? 'campaign' : 'oneshot';
}

function parseDateKey(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function dateKeyFromDate(date: Date) {
  return [date.getUTCFullYear(), String(date.getUTCMonth() + 1).padStart(2, '0'), String(date.getUTCDate()).padStart(2, '0')].join('-');
}

function addDays(value: string, amount: number) {
  const date = parseDateKey(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return dateKeyFromDate(date);
}

function todayInMoscow() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function startOfWeek(value: string) {
  const date = parseDateKey(value);
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - mondayOffset);
  return dateKeyFromDate(date);
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parseDateKey(date)).replace(',', '');
}

function formatDayName(date: string) {
  return new Intl.DateTimeFormat('ru-RU', { weekday: 'long', timeZone: 'UTC' }).format(parseDateKey(date));
}

function formatWeekRange(start: string) {
  const end = addDays(start, 6);
  const formatter = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return `${formatter.format(parseDateKey(start))} — ${formatter.format(parseDateKey(end))}`;
}

function startOfMonth(value: string) {
  const date = parseDateKey(value);
  date.setUTCDate(1);
  return dateKeyFromDate(date);
}

function endOfMonth(value: string) {
  const date = parseDateKey(startOfMonth(value));
  date.setUTCMonth(date.getUTCMonth() + 1);
  date.setUTCDate(0);
  return dateKeyFromDate(date);
}

function monthGridStart(value: string) {
  return startOfWeek(startOfMonth(value));
}

function monthGridEnd(value: string) {
  return addDays(startOfWeek(endOfMonth(value)), 6);
}

function monthLabel(value: string) {
  const label = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(parseDateKey(value));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function formatSpots(seats: number | null) {
  if (seats === null) return 'Места уточняются';
  if (seats === 0) return 'Мест нет';
  return `${seats} ${seats === 1 ? 'свободное место' : seats < 5 ? 'свободных места' : 'свободных мест'}`;
}

function formatPlace(event: CalendarEvent) {
  const location = event.location.trim();
  if (event.format === 'online') return location ? `Онлайн · ${location}` : 'Онлайн';
  if (event.format === 'offline') return !location || location.toLowerCase() === 'москва' ? 'Москва' : `Москва · ${location}`;
  return event.location || 'Формат уточняется';
}

function eventImage(event: CalendarEvent) {
  const source = `${event.system} ${event.title}`.toLowerCase();
  if (source.includes('vampire') || source.includes('вампир')) return '/assets/system-vampires.png';
  if (source.includes('dagger')) return '/assets/system-daggerheart.png';
  if (source.includes('cyber')) return '/assets/system-cyberpunk.png';
  return '/assets/system-dnd.png';
}

function eventOccursOn(event: CalendarEvent, date: string) {
  if (date < event.eventDate || (event.recurrenceUntil && date > event.recurrenceUntil) || event.excludedDates.includes(date)) return false;
  if (event.recurrence === 'none') return date === event.eventDate;

  const start = parseDateKey(event.eventDate);
  const current = parseDateKey(date);
  const daysSinceStart = Math.round((current.getTime() - start.getTime()) / 86400000);
  if (event.recurrence === 'daily') return true;
  if (event.recurrence === 'weekly') return daysSinceStart % 7 === 0;
  if (event.recurrence === 'biweekly') return daysSinceStart % 14 === 0;
  if (event.recurrence === 'monthly') return current.getUTCDate() === start.getUTCDate();
  return date === event.eventDate;
}

function toGame(event: CalendarEvent, occurrenceDate: string): Game {
  const title = event.title || (event.status === 'day_off' ? 'Выходной' : event.status === 'children_group' ? 'Детская группа' : 'Свободный слот');
  return {
    id: `${event.id}:${occurrenceDate}`,
    eventId: event.id,
    title,
    system: event.system || 'Авторская игра',
    dateISO: occurrenceDate,
    date: formatDate(occurrenceDate),
    time: event.status === 'open_slot' || event.status === 'day_off' ? '—' : event.startTime || 'Уточняется',
    place: formatPlace(event),
    price: event.price || 'Уточняется',
    spots: formatSpots(event.seats),
    image: eventImage(event),
    description: event.description || 'Подробности игры обсудим перед подтверждением участия.',
    status: event.status,
    seats: event.seats,
    format: event.format,
    storyType: storyTypeForEvent(event),
    experience: event.experience,
  };
}

function expandEvents(events: CalendarEvent[], startDate: string, endDate: string) {
  return events
    .filter((event) => !event.archived)
    .flatMap((event) => {
      const firstDate = event.eventDate > startDate ? event.eventDate : startDate;
      const occurrences: Game[] = [];
      for (let date = firstDate; date <= endDate; date = addDays(date, 1)) {
        if (eventOccursOn(event, date)) occurrences.push(toGame(event, date));
      }
      return occurrences;
    })
    .sort((a, b) => `${a.dateISO}${a.time}${a.title}`.localeCompare(`${b.dateISO}${b.time}${b.title}`));
}

function canApply(game: Game) {
  return (game.status === 'available' || game.status === 'waiting') && (game.seats === null || game.seats > 0 || game.status === 'waiting');
}

function availabilityLabel(game: Game) {
  if (game.status === 'day_off') return 'Выходной';
  if (game.status === 'children_group') return 'Детская группа';
  if (game.status === 'open_slot') return 'Свободный слот';
  if (game.status === 'ongoing') return 'Кампания идёт';
  if (game.status === 'closed') return 'В заморозке';
  if (game.status === 'waiting') return 'Лист ожидания';
  return game.spots;
}

function useLiveGames() {
  const query = useGetCalendar();
  const today = todayInMoscow();
  const events = query.data?.events ?? [];
  const games = useMemo(() => {
    return expandEvents(events, today, addDays(today, 90));
  }, [events, today]);
  return { ...query, events, games };
}

type HomeSectionLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { sectionId: string };

function preferredScrollBehavior(): ScrollBehavior {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}

function HomeSectionLink({ sectionId, onClick, children, ...props }: HomeSectionLinkProps) {
  const [location, navigate] = useLocation();
  const target = `/#${sectionId}`;

  function handleClick(event: ReactMouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    onClick?.(event);
    if (event.defaultPrevented) return;
    event.preventDefault();
    navigate(target, { transition: true });

    const scrollToSection = () => {
      document.getElementById(sectionId)?.scrollIntoView({ behavior: preferredScrollBehavior(), block: 'start' });
    };
    // A cross-page navigation needs one render before the target section exists.
    requestAnimationFrame(() => {
      scrollToSection();
      if (location !== '/') requestAnimationFrame(scrollToSection);
    });
  }

  return <a {...props} href={target} onClick={handleClick}>{children}</a>;
}

function Header() {
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const pathname = location.split(/[?#]/, 1)[0].replace(/\/+$/, '') || '/';

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <header className="site-nav" data-testid="site-header">
      <Link href="/" className="brand" onClick={close} data-testid="link-brand">
        <span className="brand-mark">N</span>
        <span>МАДМУАЗЕЛЬ НИКС</span>
      </Link>
      <button className="menu-button" type="button" onClick={() => setOpen((current) => !current)} aria-label={open ? 'Закрыть меню' : 'Открыть меню'} aria-expanded={open} aria-controls="main-navigation" data-testid="button-menu">
        {open ? <X size={17} aria-hidden="true" /> : <Menu size={17} aria-hidden="true" />}
      </button>
      <nav id="main-navigation" className={`nav-links ${open ? 'open' : ''}`} aria-label="Основная навигация">
        <Link href="/games" className={`nav-link ${pathname === '/games' ? 'active' : ''}`} onClick={close} data-testid="link-games">Игры</Link>
        <Link href="/calendar" className={`nav-link ${pathname === '/calendar' || pathname === '/calendar/week' ? 'active' : ''}`} onClick={close} data-testid="link-calendar">Календарь</Link>
        <HomeSectionLink sectionId="about" className="nav-link" onClick={close} data-testid="link-about">Как это работает</HomeSectionLink>
        <HomeSectionLink sectionId="faq" className="nav-link" onClick={close} data-testid="link-faq">FAQ</HomeSectionLink>
        <Link href="/anketa" className="nav-cta" onClick={close} data-testid="link-nav-apply">Записаться <ArrowUpRight size={14} /></Link>
      </nav>
    </header>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="nyx-site">
      <div className="page-shell">
        <Header />
        {children}
        <footer className="footer" data-testid="site-footer">
          <span>© 2026 Мадмуазель Никс · авторские игры</span>
          <div className="footer-links">
            <a href="https://t.me/mad_maze_elle" target="_blank" rel="noreferrer" data-testid="link-telegram">Написать в Telegram</a>
            <a href="https://t.me/mad_maze_elle_dnd" target="_blank" rel="noreferrer" data-testid="link-channel">Telegram-канал</a>
            <a href="https://discord.com/invite/madmazeellednd" target="_blank" rel="noreferrer" data-testid="link-discord">Discord</a>
            <Link href="/anketa" data-testid="link-footer-apply">Заполнить анкету</Link>
            <a className="footer-support" href="https://dzen.ru/mad_maze_elle_dnd?donate=true" target="_blank" rel="noreferrer" data-testid="link-support">Поддержать проект</a>
            <a className="footer-icons-credit" href="https://www.flaticon.com/uicons" target="_blank" rel="noreferrer">Иконки: Flaticon UIcons</a>
          </div>
        </footer>
      </div>
    </div>
  );
}

type CatalogSystem = {
  number: string;
  slug: string;
  title: string;
  subtitle: string;
  status: string;
  artwork: string;
};

const catalogGroups: CatalogSystem[] = [
  { number: '01', slug: 'dnd', title: 'Dungeons & Dragons', subtitle: 'D&D 5e', status: 'Ваншоты и кампании', artwork: '/assets/system-dnd.png' },
  { number: '02', slug: 'vampires', title: 'Вампиры: Маскарад', subtitle: 'Vampire: The Masquerade', status: 'Готический хоррор', artwork: '/assets/system-vampires.png' },
  { number: '03', slug: 'daggerheart', title: 'Daggerheart', subtitle: 'Героическое фэнтези', status: 'Игры и кампании', artwork: '/assets/system-daggerheart.png' },
  { number: '04', slug: 'cyberpunk', title: 'Cyberpunk 2020', subtitle: 'Тёмное будущее', status: 'Игры и кампании', artwork: '/assets/system-cyberpunk.png' },
  { number: '05', slug: 'cthulhu', title: 'Зов Ктулху', subtitle: 'Call of Cthulhu', status: 'В разработке', artwork: '/assets/system-cthulhu.png' },
];

type CatalogItem = {
  id: string;
  gameType: 'campaign' | 'oneshot';
  systemKey: string;
  title: string;
  description: string;
  imageUrl: string;
  status: string;
  price: string;
  format: string;
  age?: string;
  players?: string;
  duration?: string;
  tags?: string[];
  sortOrder: number;
  published: boolean;
  updatedAt: string;
};

type CatalogResponse = { items: CatalogItem[] };

function normalizeSystemKey(value: string) {
  const source = value.toLowerCase().replace(/ё/g, 'е');
  if (source.includes('dnd') || source.includes('d&d') || source.includes('dungeons') || source.includes('днд')) return 'dnd';
  if (source.includes('vampire') || source.includes('вампир')) return 'vampires';
  if (source.includes('dagger')) return 'daggerheart';
  if (source.includes('cyber')) return 'cyberpunk';
  if (source.includes('cthulhu') || source.includes('ктул')) return 'cthulhu';
  return value;
}

function catalogFormatLabel(value: string) {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!normalized) return 'Онлайн или очно';
  if ((normalized.includes('online') || normalized.includes('онлайн')) && (normalized.includes('offline') || normalized.includes('очно'))) return 'Онлайн и очно';
  if (normalized === 'online' || normalized === 'онлайн') return 'Онлайн';
  if (normalized === 'offline' || normalized === 'оффлайн' || normalized === 'очно' || normalized === 'офлайн') return 'Очно';
  return value.trim();
}

function useCatalog() {
  return useQuery({
    queryKey: ['/api/catalog'],
    queryFn: async () => {
      const response = await fetch('/api/catalog', { cache: 'no-store', headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('Не удалось загрузить каталог.');
      const payload = await response.json() as Partial<CatalogResponse>;
      if (!Array.isArray(payload.items)) return { items: [] };
      return { items: payload.items.filter((item) => item.published !== false) };
    },
    staleTime: 0,
    refetchOnMount: true,
  });
}

function SystemShowcase({ selectedSystem }: { selectedSystem?: string }) {
  return (
    <section className="catalog-kind" aria-labelledby="catalog-systems-title">
      <div className="catalog-kind-heading">
        <div><span className="catalog-kicker">СИСТЕМЫ</span><h3 id="catalog-systems-title">Выберите мир</h3></div>
        <p>Нажми на обложку, чтобы открыть игры в этой системе.</p>
      </div>
      {selectedSystem && <div className="catalog-filter-status"><span>Выбрана система: {catalogGroups.find((group) => group.slug === selectedSystem)?.title}</span><Link href="/games">Показать все</Link></div>}
      <div className="system-showcase-grid">
        {catalogGroups.map((group) => (
          <Link
            key={group.slug}
            className={`system-showcase-card${group.slug === 'cthulhu' ? ' is-development' : ''}${group.slug === selectedSystem ? ' is-selected' : ''}`}
            href={`/games?system=${group.slug}`}
            aria-label={`${group.title}: открыть каталог`}
          >
            <img src={group.artwork} alt="" loading="lazy" decoding="async" />
            <span className="system-showcase-shade" aria-hidden="true" />
            <span className="system-showcase-number">{group.number}</span>
            <span className="system-showcase-copy"><small>{group.status}</small><strong>{group.title}</strong><span>{group.subtitle}</span></span>
            {group.slug === 'cthulhu' && <span className="system-showcase-development">В РАЗРАБОТКЕ</span>}
            <ArrowUpRight className="system-showcase-arrow" size={18} aria-hidden="true" />
          </Link>
        ))}
      </div>
    </section>
  );
}

function CatalogSection({ id = 'catalog', selectedSystem }: { id?: string; selectedSystem?: string }) {
  return (
    <section className="catalog-section" id={id} data-testid="catalog-section">
      <div className="catalog-section-head">
        <div>
          <div className="section-kicker">01 — КАТАЛОГ ИГР</div>
          <h2>Каталог<br /><em>игр</em></h2>
        </div>
        <p>Пять систем — от готического хоррора до светлого фэнтези и неонового будущего. Формат, тон и состав группы обсудим до записи.</p>
      </div>
      <div className="catalog-layout">
        <div className="catalog-kinds"><SystemShowcase selectedSystem={selectedSystem} /></div>
        <aside className="pricing-panel" id="prices" aria-labelledby="prices-title">
          <span className="catalog-kicker">КОШЕЛЁЧЕК ДЛЯ МАДМУАЗЕЛЬ</span>
          <div className="pricing-rune" aria-hidden="true">₽</div>
          <h3 id="prices-title">Цены<br /><em>на игры</em></h3>
          <p className="pricing-intro">Для кампаний и ваншотов цена едина для онлайн-игр и игр очно в Москве.</p>
          <dl className="pricing-list">
            <div><dt>Кампании</dt><dd>1 000 руб.</dd></div>
            <div><dt>Ваншоты</dt><dd>1 500 руб.</dd></div>
            <div><dt>Закрытая группа</dt><dd>отдельный расчёт</dd></div>
          </dl>
          <p className="pricing-note">В стоимость входит подготовка мастера, помощь с персонажем и материалы по сценарию.</p>
          <Link href="/anketa" className="text-link">Подобрать игру <ArrowUpRight size={14} /></Link>
        </aside>
      </div>
    </section>
  );
}

function catalogSystem(slug: string) {
  const normalized = normalizeSystemKey(slug);
  return catalogGroups.find((group) => group.slug === normalized) ?? catalogGroups[0];
}

function isBeginnerFriendly(item: CatalogItem) {
  return /нович|познаком|первая игра/i.test(`${item.status} ${item.title} ${item.description}`);
}

function CatalogGameCard({ item }: { item: CatalogItem }) {
  const system = catalogSystem(item.systemKey);
  const kind = item.gameType === 'campaign' ? 'Кампания' : 'Ваншот';
  const format = catalogFormatLabel(item.format);
  const price = item.price?.trim() || (item.gameType === 'campaign' ? '1 000 руб.' : '1 500 руб.');
  const age = item.age?.trim() || 'Возраст уточняется';
  const players = item.players?.trim() || '3–5 игроков';
  const tags = Array.from(new Set([kind, age, format, ...(item.status?.trim() ? [item.status.trim()] : []), ...(item.tags ?? []), ...(isBeginnerFriendly(item) ? ['Подходит новичкам'] : [])]));

  return (
    <article className="catalog-game-card">
      <div className="catalog-game-cover" style={{ backgroundImage: `url(${system.artwork})` }}>
        {item.imageUrl && <img src={item.imageUrl} alt={`Обложка игры «${item.title}»`} loading="lazy" decoding="async" onError={(event) => { event.currentTarget.style.display = 'none'; }} />}
        <div className="catalog-game-tags">{tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
      </div>
      <div className="catalog-game-body">
        <span className="catalog-game-system">{system.title}</span>
        <h2>{item.title}</h2>
        <p>{item.description || 'Детали истории и тон игры обсудим перед записью.'}</p>
        <dl className="catalog-game-facts">
          <div><dt>Цена</dt><dd>{price}</dd></div>
          <div><dt>Стол</dt><dd>{players}</dd></div>
          <div><dt>Формат</dt><dd>{format}</dd></div>
          {item.duration && <div><dt>Длительность</dt><dd>{item.duration}</dd></div>}
        </dl>
        <Link className="catalog-game-action" href={`/anketa?gameId=${encodeURIComponent(item.id)}&game=${encodeURIComponent(item.title)}&system=${encodeURIComponent(item.systemKey)}`}>Узнать об игре <ArrowUpRight size={14} /></Link>
      </div>
    </article>
  );
}

function CatalogBrowser({ selectedSystem }: { selectedSystem?: string }) {
  const [kind, setKind] = useState<'all' | 'campaign' | 'oneshot'>('all');
  const { data, isLoading, isError, refetch } = useCatalog();
  const items = (data?.items ?? []).filter((item) => (!selectedSystem || normalizeSystemKey(item.systemKey) === selectedSystem) && (kind === 'all' || item.gameType === kind));
  const selected = selectedSystem ? catalogGroups.find((group) => group.slug === selectedSystem) : undefined;
  const groupedItems = catalogGroups
    .filter((group) => group.slug !== 'cthulhu')
    .map((group) => ({ group, items: items.filter((item) => normalizeSystemKey(item.systemKey) === group.slug) }))
    .filter(({ items: groupItems }) => groupItems.length > 0);

  return (
    <section className="catalog-browser" aria-labelledby="catalog-list-title">
      <div className="catalog-browser-heading">
        <div><span className="catalog-kicker">ИГРЫ В КАТАЛОГЕ</span><h2 id="catalog-list-title">{selected ? selected.title : 'Все истории'}</h2></div>
        <div className="catalog-kind-filters" role="group" aria-label="Тип игры">
          <button type="button" className={kind === 'all' ? 'is-active' : ''} onClick={() => setKind('all')}>Все</button>
          <button type="button" className={kind === 'oneshot' ? 'is-active' : ''} onClick={() => setKind('oneshot')}>Ваншоты</button>
          <button type="button" className={kind === 'campaign' ? 'is-active' : ''} onClick={() => setKind('campaign')}>Кампании</button>
        </div>
      </div>
      {isLoading && <div className="calendar-state" role="status">Загружаем игры…</div>}
      {isError && <div className="calendar-state" role="alert"><h2>Каталог временно недоступен</h2><p>Не удалось получить актуальные карточки.</p><button className="button button-primary" onClick={() => refetch()}>Повторить</button></div>}
      {!isLoading && !isError && selectedSystem === 'cthulhu' && <div className="catalog-development-state">
        <img src="/assets/system-cthulhu.png" alt="Штормовое море и маяк" />
        <div><span className="catalog-kicker">СИСТЕМА 05</span><h2>Зов Ктулху пока в разработке</h2><p>Новые игры появятся здесь, когда система будет готова к запуску.</p><Link href="/anketa" className="button button-ghost">Оставить пожелание</Link></div>
      </div>}
      {!isLoading && !isError && selectedSystem !== 'cthulhu' && (items.length ? selectedSystem ? <div className="catalog-game-grid">
        {items.map((item) => <CatalogGameCard item={item} key={item.id} />)}
      </div> : <div className="catalog-system-sections">
        {groupedItems.map(({ group, items: groupItems }) => <section className="catalog-system-section" key={group.slug} aria-labelledby={`catalog-system-${group.slug}`}>
          <div className="catalog-system-section-head"><div><span className="catalog-kicker">СИСТЕМА {group.number}</span><h3 id={`catalog-system-${group.slug}`}>{group.title}</h3></div><Link href={`/games?system=${group.slug}`}>Все игры <ArrowUpRight size={14} /></Link></div>
          <div className="catalog-game-grid">{groupItems.map((item) => <CatalogGameCard item={item} key={item.id} />)}</div>
        </section>)}
      </div> : <div className="calendar-state"><h2>Подходящих игр пока нет</h2><p>Смените фильтр или оставьте пожелание — подберём формат вместе.</p><Link href="/anketa" className="button button-primary">Оставить пожелание</Link></div>)}
    </section>
  );
}

function Home() {
  return (
    <Shell>
      <main>
        <section className="hero" data-testid="hero-section">
          <div className="hero-copy reveal">
            <div className="eyebrow">авторские ролевые игры · москва / онлайн</div>
            <h1>Истории,<br /><em>в которые</em><br />входят</h1>
            <p className="hero-lead">Я — Никс. Веду камерные игры для тех, кому мало просто бросить кубик. Здесь у каждого решения есть цена, у каждого героя — тайна, а у каждой встречи — продолжение.</p>
            <div className="hero-actions">
              <Link href="/calendar" className="button button-primary" data-testid="button-hero-calendar">Посмотреть расписание <ArrowUpRight size={16} /></Link>
              <Link href="/games" className="button button-ghost" data-testid="button-hero-games">Подобрать игру</Link>
            </div>
            <div className="hero-note">
              <span><Check size={14} color="#d8ff55" /> Новичкам можно</span>
              <span><Check size={14} color="#d8ff55" /> 18+ и бережная группа</span>
            </div>
          </div>
          <div className="hero-art reveal delay-1">
            <span className="orb one">d20<br />roll</span>
            <span className="orb two">+1</span>
            <img className="hero-character" src="/assets/nyx-cutout.png" alt="Мадмуазель Никс за игровым столом" fetchPriority="high" decoding="async" data-testid="img-nyx-hero" />
          </div>
          <span className="scroll-tag">листай, если готова</span>
        </section>

        <div className="signal-strip" data-testid="trust-signals">
          <div className="signal"><span className="signal-icon">01</span><span><strong>5 лет</strong><br />веду игры</span></div>
          <div className="signal"><span className="signal-icon">06</span><span><strong>игроков</strong><br />в одной группе</span></div>
          <div className="signal"><span className="signal-icon">∞</span><span><strong>100%</strong><br />живых решений</span></div>
          <div className="signal"><ArrowUpRight className="signal-icon" size={17} aria-hidden="true" /><span><strong>Москва</strong><br />и любой экран</span></div>
        </div>

        <CatalogSection id="games" />

        <section className="section" id="about" data-testid="about-section">
          <div className="path-grid">
            <div className="path-copy"><div className="section-kicker">как это работает</div><h2>Не нужно<br />знать всё</h2><p>Не читала Player’s Handbook? Отлично. Я объясню правила, помогу собрать персонажа и позабочусь, чтобы за столом было место и для смелости, и для тишины.</p><Link href="/anketa" className="button button-ghost" style={{ marginTop: '18px' }} data-testid="button-about-apply">Рассказать о себе <ArrowUpRight size={15} /></Link></div>
            <div className="path-steps">
              <div className="path-step"><span className="step-number">01</span><div><h3>Выбираешь мир</h3><p>Фэнтези, готический ужас, сказка или неон. В календаре есть игры для разного опыта и настроения.</p></div></div>
              <div className="path-step"><span className="step-number">02</span><div><h3>Заполняешь анкету</h3><p>Пять минут, чтобы понять, что тебе интересно. Никаких экзаменов на «правильного игрока».</p></div></div>
              <div className="path-step"><span className="step-number">03</span><div><h3>Получаешь приглашение</h3><p>Я напишу тебе в Telegram, отвечу на вопросы и пришлю всё нужное до первой встречи.</p></div></div>
            </div>
          </div>
        </section>

        <section className="section" data-testid="gallery-section">
          <div className="section-head"><div><div className="section-kicker">что остаётся за кадром</div><h2>Мир уже<br />ждёт тебя</h2></div><p className="section-intro">Карты, миниатюры, музыка, свечи и немного хаоса на столе. Всё, что помогает истории стать настоящей.</p></div>
          <div className="gallery-layout">
            <div className="gallery-main"><img src="/assets/table.jpg" alt="Игровой стол с картами и кубиками" loading="lazy" decoding="async" data-testid="img-gallery-table" /><span className="gallery-caption">Стол — тоже часть сюжета.</span></div>
            <div className="gallery-side">
              <div className="gallery-tile"><img src="/assets/story-map.jpg" alt="Карта и заметки из игрового мира" loading="lazy" decoding="async" data-testid="img-gallery-map" /><span className="gallery-caption">Следы</span></div>
              <div className="gallery-tile"><img src="/assets/cards.jpg" alt="Авторские карты персонажей" loading="lazy" decoding="async" data-testid="img-gallery-cards" /><span className="gallery-caption">Знаки</span></div>
              <div className="gallery-tile"><img src="/assets/miniatures.jpg" alt="Миниатюры на игровом поле" loading="lazy" decoding="async" data-testid="img-gallery-miniatures" /><span className="gallery-caption">Фигуры</span></div>
            </div>
          </div>
        </section>

        <section className="trust-section" data-testid="testimonial-section">
          <div className="section-kicker">из дневника партии</div>
          <h2>«Я пришла одна,<br />а ушла с историей»</h2>
          <div className="trust-grid">
            <div><p className="quote">«Никс умеет дать сцене воздух. Здесь не нужно быть самым громким за столом, чтобы твой выбор что-то изменил.»</p><div className="quote-author">— Маша, игрок с 2022 года</div></div>
            <div className="trust-list">
              <div className="trust-item"><b>01</b><span>Никаких случайных незнакомцев: перед игрой я знакомлю группу и собираю ожидания.</span></div>
              <div className="trust-item"><b>02</b><span>Безопасность важнее драматургии. У каждой игры есть Lines & Veils и X-card.</span></div>
              <div className="trust-item"><b>03</b><span>Цена известна заранее: в неё уже входят подготовка, материалы и моё время.</span></div>
            </div>
          </div>
        </section>

        <section className="section" id="faq" data-testid="faq-section">
          <div className="section-head"><div><div className="section-kicker">вопросы перед входом</div><h2>Спросить<br />не стыдно</h2></div><p className="section-intro">Собрала то, о чём обычно спрашивают в первом сообщении. Если твоего вопроса здесь нет — напиши мне в анкете.</p></div>
          <div className="faq-grid">
            <Faq question="Можно, если я никогда не играла?" answer="Да. Большинство групп открыты для новичков. Я объясню базовые правила до начала и буду рядом, когда появится первый вопрос." />
            <Faq question="Сколько длится игра?" answer="Обычно 4–5 часов с коротким перерывом. Перед каждой встречей я заранее обозначаю точное время окончания." />
            <Faq question="Что входит в цену?" answer="Подготовка сюжета и материалов, ведение игры, музыка, карты и пост-игровое резюме. Для онлайна — все нужные ссылки." />
            <Faq question="А если я не смогу прийти?" answer="Предупреди минимум за 48 часов — перенесём запись или вернём оплату. При срочной ситуации всегда сначала поговорим." />
            <Faq question="Где проходят офлайн-игры?" answer="В уютных антикафе в центре Москвы, обычно рядом с метро Бауманская или Курская. Точный адрес приходит после подтверждения группы." />
            <Faq question="Можно придумать свою кампанию?" answer="Конечно. В анкете есть поле для идеи — расскажи, какой мир хочется прожить, а я предложу формат и бюджет." />
          </div>
        </section>
      </main>
    </Shell>
  );
}

function Faq({ question, answer }: { question: string; answer: string }) {
  return <details className="faq-item"><summary data-testid={`faq-${question}`}>{question}</summary><p>{answer}</p></details>;
}

type CalendarView = 'month' | 'week';

function CalendarPage({ initialView = 'month' }: { initialView?: CalendarView }) {
  const { events, games: upcomingGames, isLoading, isError, refetch } = useLiveGames();
  const today = todayInMoscow();
  const [view, setView] = useState<CalendarView>(initialView);
  const [monthStart, setMonthStart] = useState(() => startOfMonth(today));
  const [weekStart, setWeekStart] = useState(() => startOfWeek(today));
  const [formatFilter, setFormatFilter] = useState('all');
  const [storyFilter, setStoryFilter] = useState('all');
  const [beginnersOnly, setBeginnersOnly] = useState(false);
  const filterGames = (games: Game[]) => games.filter((game) => {
    const normalizedFormat = game.format.toLowerCase();
    const experience = game.experience.toLowerCase();
    const formatMatches = formatFilter === 'all' || (formatFilter === 'online' ? normalizedFormat.includes('online') : normalizedFormat.includes('offline'));
    const storyMatches = storyFilter === 'all' || game.storyType === storyFilter;
    const beginnerMatches = !beginnersOnly || !experience || /нович|любой|начин/.test(experience);
    return formatMatches && storyMatches && beginnerMatches;
  });
  const monthStartDate = monthGridStart(monthStart);
  const monthEndDate = monthGridEnd(monthStart);
  const monthGames = useMemo(() => filterGames(expandEvents(events, monthStartDate, monthEndDate)), [beginnersOnly, events, formatFilter, monthEndDate, monthStartDate, storyFilter]);
  const monthGamesByDate = useMemo(() => {
    const grouped = new Map<string, Game[]>();
    monthGames.forEach((game) => grouped.set(game.dateISO, [...(grouped.get(game.dateISO) ?? []), game]));
    return grouped;
  }, [monthGames]);
  const monthGrid = useMemo(() => {
    const gridDays = Math.round((parseDateKey(monthEndDate).getTime() - parseDateKey(monthStartDate).getTime()) / 86400000) + 1;
    return Array.from({ length: gridDays }, (_, index) => {
      const date = addDays(monthStartDate, index);
      return { date, games: monthGamesByDate.get(date) ?? [] };
    });
  }, [monthEndDate, monthGamesByDate, monthStartDate]);
  const weekGames = useMemo(() => filterGames(expandEvents(events, weekStart, addDays(weekStart, 6))), [beginnersOnly, events, formatFilter, storyFilter, weekStart]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, index) => {
    const date = addDays(weekStart, index);
    return { date, label: weekDayLabels[index], name: formatDayName(date), games: weekGames.filter((game) => game.dateISO === date) };
  }), [weekGames, weekStart]);
  const monthScheduledCount = monthGames.filter((game) => game.dateISO.slice(0, 7) === monthStart.slice(0, 7) && !calendarOnlyStatuses.has(game.status)).length;
  const scheduledCount = view === 'month' ? monthScheduledCount : weekGames.filter((game) => !calendarOnlyStatuses.has(game.status)).length;

  function moveMonth(offset: number) {
    setMonthStart((current) => { const date = parseDateKey(current); date.setUTCMonth(date.getUTCMonth() + offset); return startOfMonth(dateKeyFromDate(date)); });
  }
  function moveWeek(offset: number) { setWeekStart((current) => addDays(current, offset * 7)); }
  function showToday() { setMonthStart(startOfMonth(today)); setWeekStart(startOfWeek(today)); }

  return (
    <Shell>
      <main className="subpage calendar-page">
        <div className="calendar-hero reveal">
          <div className="eyebrow">единый календарь игр</div>
          <h1>{view === 'month' ? <>Весь месяц<br /><em>перед глазами</em></> : <>Неделя<br /><em>перед глазами</em></>}</h1>
          <p>Здесь собраны открытые наборы, текущие кампании, детские группы, выходные и свободные слоты. Не нашли подходящую дату — <Link href="/anketa">оставьте пожелания</Link>.</p>
        </div>
        <div className="calendar-view-switch" role="tablist" aria-label="Вид календаря">
          <Link href="/calendar" role="tab" aria-selected={view === 'month'} className={view === 'month' ? 'is-active' : ''} onClick={() => setView('month')}>Месяц</Link>
          <Link href="/calendar/week" role="tab" aria-selected={view === 'week'} className={view === 'week' ? 'is-active' : ''} onClick={() => setView('week')}>Неделя</Link>
        </div>
        {isLoading && <div className="calendar-state" role="status">Загружаем расписание…</div>}
        {isError && <div className="calendar-state" role="alert"><h2>Календарь временно недоступен</h2><p>Не удалось получить актуальные даты. Попробуйте обновить список.</p><button className="button button-primary" onClick={() => refetch()}>Обновить календарь</button></div>}
        {!isLoading && !isError && <>
          <div className="calendar-filters">
            <label><span>Где играем</span><select value={formatFilter} onChange={(event) => setFormatFilter(event.target.value)}><option value="all">Любой формат</option><option value="online">Онлайн</option><option value="offline">Очно в Москве</option></select></label>
            <label><span>Длина истории</span><select value={storyFilter} onChange={(event) => setStoryFilter(event.target.value)}><option value="all">Ваншоты и кампании</option><option value="oneshot">Ваншот — одна встреча</option><option value="campaign">Кампания — серия встреч</option></select></label>
            <label className="calendar-check"><input type="checkbox" checked={beginnersOnly} onChange={(event) => setBeginnersOnly(event.target.checked)} /><span>Подходит новичкам</span></label>
          </div>
          {view === 'month' ? <section className="calendar-week" aria-labelledby="calendar-month-title">
            <div className="calendar-week-toolbar"><div><h2 id="calendar-month-title">{monthLabel(monthStart)}</h2><p>Время московское · открытые наборы и ближайшие встречи</p></div><div className="calendar-week-nav" aria-label="Навигация по месяцам"><button type="button" onClick={() => moveMonth(-1)} aria-label="Предыдущий месяц">←</button><button type="button" className="calendar-week-current" onClick={showToday}>Сегодня</button><button type="button" onClick={() => moveMonth(1)} aria-label="Следующий месяц">→</button></div></div>
            <div className="calendar-week-meta"><span>{monthLabel(monthStart)}</span><strong>В расписании: {scheduledCount}</strong></div>
            <div className="calendar-month-scroll" role="grid" aria-label={`Календарь на ${monthLabel(monthStart)}`}><div className="calendar-month-weekdays" aria-hidden="true">{weekDayLabels.map((label) => <span key={label}>{label}</span>)}</div><div className="calendar-month-grid">{monthGrid.map((day) => <section className={`calendar-month-day${day.date === today ? ' is-today' : ''}${day.date < today ? ' is-past' : ''}${day.date.slice(0, 7) !== monthStart.slice(0, 7) ? ' is-other-month' : ''}`} role="gridcell" aria-label={formatDate(day.date)} key={day.date}><header><span>{parseDateKey(day.date).getUTCDate()}</span></header><div>{day.games.slice(0, 3).map((game) => <MonthGame game={game} key={game.id} />)}{day.games.length > 3 && <span className="calendar-month-more">+{day.games.length - 3} ещё</span>}</div></section>)}</div></div>
          </section> : <section className="calendar-week" aria-labelledby="calendar-week-title">
            <div className="calendar-week-toolbar"><div><h2 id="calendar-week-title">Расписание на неделю</h2><p>Время московское · открытые наборы и ближайшие встречи</p></div><div className="calendar-week-nav" aria-label="Навигация по неделям"><button type="button" onClick={() => moveWeek(-1)} aria-label="Предыдущая неделя">←</button><button type="button" className="calendar-week-current" onClick={showToday}>Эта неделя</button><button type="button" onClick={() => moveWeek(1)} aria-label="Следующая неделя">→</button></div></div>
            <div className="calendar-week-meta"><span>{formatWeekRange(weekStart)}</span><strong>В расписании: {scheduledCount}</strong></div>
            <div className="calendar-week-grid-scroll"><div className="calendar-week-grid">{weekDays.map((day) => <section className={`calendar-day${day.date === today ? ' is-today' : ''}${day.date < today ? ' is-past' : ''}`} key={day.date} aria-labelledby={`calendar-day-${day.date}`}><header className="calendar-day-head"><div><span>{day.label}</span><strong>{parseDateKey(day.date).getUTCDate()}</strong></div><small id={`calendar-day-${day.date}`}>{day.name}</small></header><div className="calendar-day-body">{day.games.length ? day.games.map((game) => <WeeklyGame game={game} key={game.id} />) : <p className="calendar-day-empty">Свободный день</p>}</div></section>)}</div></div>
          </section>}
        </>}
        {!isLoading && !isError && <section className="calendar-actions-bottom" aria-label="Действия с расписанием" data-testid="calendar-bottom-actions"><div><span className="catalog-kicker">СЛЕДУЮЩИЙ ШАГ</span><h2>Нашли свой слот?</h2><p>Запишитесь на открытую игру или добавьте новую встречу в мастерском календаре.</p></div><div className="calendar-actions-buttons"><Link href="/anketa" className="button button-primary">Записаться на игру <ArrowUpRight size={15} /></Link><Link href="/master/calendar" className="button button-ghost">Добавить игру <ArrowUpRight size={15} /></Link></div></section>}
      </main>
    </Shell>
  );
}

function MonthGame({ game }: { game: Game }) {
  const isPast = game.dateISO < todayInMoscow();
  const interactive = !isPast && (canApply(game) || game.status === 'open_slot');
  const className = `calendar-month-event calendar-event-${game.status}${isPast ? ' is-past' : ''}`;
  const content = <><time>{game.time === '—' ? '' : game.time}</time><span>{game.title}</span></>;
  return interactive ? <Link href={game.status === 'open_slot' ? '/anketa' : `/anketa?event=${encodeURIComponent(game.eventId)}&date=${encodeURIComponent(game.dateISO)}`} className={className} title={`${game.title} · ${game.time}`}>{content}</Link> : <article className={className} title={`${game.title} · ${game.time}`}>{content}</article>;
}

function WeeklyGame({ game }: { game: Game }) {
  const isPast = game.dateISO < todayInMoscow();
  const details = game.status === 'day_off' ? null : `${game.place}${game.system ? ` · ${game.system}` : ''}`;
  return (
    <article className={`calendar-event calendar-event-${game.status}${isPast ? ' is-past' : ''}`} data-testid={`card-calendar-${game.id}`}>
      <div className="calendar-event-top"><time>{game.time}</time><span>{availabilityLabel(game)}</span></div>
      <h3>{game.title}</h3>
      {details && <p>{details}</p>}
      {game.price && game.status !== 'day_off' && <small>{game.price}</small>}
      {canApply(game) && !isPast && <Link href={`/anketa?event=${encodeURIComponent(game.eventId)}&date=${encodeURIComponent(game.dateISO)}`} className="calendar-event-action">{game.status === 'waiting' ? 'Лист ожидания' : 'Оставить заявку'} <ArrowUpRight size={13} /></Link>}
      {game.status === 'open_slot' && !isPast && <Link href="/anketa" className="calendar-event-action">Обсудить игру <ArrowUpRight size={13} /></Link>}
    </article>
  );
}

function GamesPage() {
  const search = useSearch();
  const requestedSystem = new URLSearchParams(search).get('system') ?? '';
  const normalizedSystem = normalizeSystemKey(requestedSystem);
  const selectedSystem = catalogGroups.some((group) => group.slug === normalizedSystem) ? normalizedSystem : undefined;

  return (
    <Shell>
      <main className="subpage catalog-page">
        <CatalogBrowser selectedSystem={selectedSystem} />
      </main>
    </Shell>
  );
}

function ApplicationPage() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const searchParams = new URLSearchParams(search);
  const eventId = searchParams.get('event') ?? '';
  const occurrenceDate = searchParams.get('date') ?? '';
  const requestedGameId = searchParams.get('gameId') ?? '';
  const requestedGame = searchParams.get('game') ?? '';
  const requestedSystem = searchParams.get('system') ?? '';
  const requestedCatalogSystem = catalogGroups.find((group) => group.slug === normalizeSystemKey(requestedSystem))?.title ?? requestedSystem;
  const hasSelection = Boolean(eventId && occurrenceDate);
  const { games, isLoading: isGamesLoading } = useLiveGames();
  const catalogQuery = useCatalog();
  const catalogItems = catalogQuery.data?.items ?? [];
  const [gameChoice, setGameChoice] = useState('custom');
  const selectionQuery = useGetApplicationSelection(
    { event: eventId, date: occurrenceDate },
    { query: { queryKey: ['/api/applications', eventId, occurrenceDate], enabled: hasSelection, staleTime: 0, refetchOnMount: true } },
  );
  const submitMutation = useSubmitApplication();
  const [sent, setSent] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [stepError, setStepError] = useState('');
  const [step, setStep] = useState<1 | 2>(1);
  const [consent, setConsent] = useState(false);
  const [submissionId] = useState(() => crypto.randomUUID());
  const [form, setForm] = useState({
    name: '',
    contact: '',
    players: '1',
    game: requestedGame || 'Подобрать игру вместе',
    format: 'Пока не знаю',
    place: 'Готовы обсудить',
    experience: '',
    system: requestedCatalogSystem,
    genres: '',
    tone: '',
    wishes: '',
    schedule: '',
    boundaries: '',
    website: '',
  });
  const selectedGame: GameSelection | undefined = selectionQuery.data?.game;

  useEffect(() => {
    if (eventId && occurrenceDate) {
      setGameChoice(`event:${eventId}:${occurrenceDate}`);
      return;
    }
    if (requestedGame) {
      const catalogItem = catalogItems.find((item) => requestedGameId ? item.id === requestedGameId : item.title === requestedGame && normalizeSystemKey(item.systemKey) === normalizeSystemKey(requestedSystem));
      const calendarGame = games.find((game) => game.title === requestedGame);
      setGameChoice(catalogItem ? `catalog:${catalogItem.id}` : calendarGame ? `event:${calendarGame.eventId}:${calendarGame.dateISO}` : `custom:${requestedGame}`);
      return;
    }
    setGameChoice('custom');
  }, [catalogItems, eventId, occurrenceDate, requestedGame, requestedGameId, requestedSystem, games]);

  useEffect(() => {
    if (selectedGame) {
      setForm((current) => ({
        ...current,
        game: selectedGame.title,
        schedule: current.schedule || `${selectedGame.dateLabel}, ${selectedGame.time}`,
      }));
    }
  }, [selectedGame]);

  useEffect(() => {
    if (!selectedGame && requestedGame) {
      setForm((current) => ({ ...current, game: requestedGame, system: requestedCatalogSystem }));
    } else if (!selectedGame && !requestedGame && !eventId) {
      setForm((current) => ({ ...current, game: 'Подобрать игру вместе', system: '' }));
    }
  }, [eventId, requestedCatalogSystem, requestedGame, selectedGame]);

  const update = (key: keyof typeof form, value: string) => {
    setStepError('');
    setForm((current) => ({ ...current, [key]: value }));
  };

  const selectGame = (value: string) => {
    setStepError('');
    setGameChoice(value);
    if (value.startsWith('event:')) {
      const [, selectedEventId, selectedDate] = value.split(':');
      if (selectedEventId && selectedDate) navigate(`/anketa?event=${encodeURIComponent(selectedEventId)}&date=${encodeURIComponent(selectedDate)}`);
      return;
    }
    if (value.startsWith('catalog:')) {
      const catalogItem = catalogItems.find((item) => item.id === value.slice('catalog:'.length));
      if (catalogItem) {
        navigate(`/anketa?gameId=${encodeURIComponent(catalogItem.id)}&game=${encodeURIComponent(catalogItem.title)}&system=${encodeURIComponent(catalogItem.systemKey)}`);
        return;
      }
    }
    update('game', 'Подобрать игру вместе');
    update('system', '');
    navigate('/anketa');
  };

  function goToSecondStep() {
    setStepError('');
    if (selectionQuery.isLoading) {
      setStepError('Подождите, я проверяю выбранную игру.');
      return;
    }
    if (selectionQuery.isError) {
      setStepError('Выбранная дата больше недоступна. Вернитесь в календарь и выберите актуальную игру.');
      return;
    }
    if (!form.name.trim()) {
      setStepError('Укажите имя или ник.');
      return;
    }
    if (!form.contact.trim()) {
      setStepError('Оставьте Telegram для связи.');
      return;
    }
    if (!selectedGame && !form.game.trim()) {
      setStepError('Выберите игру или отметьте, что хотите обсудить идею.');
      return;
    }
    if (!form.schedule.trim()) {
      setStepError('Напишите, когда вам удобно играть.');
      return;
    }
    setStep(2);
  }

  function goToFirstStep() {
    setStepError('');
    setSubmitError('');
    setStep(1);
  }

  function getErrorMessage(error: unknown) {
    if (error && typeof error === 'object' && 'data' in error) {
      const data = (error as { data?: unknown }).data;
      if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string') return data.error;
    }
    return error instanceof Error ? error.message : 'Не получилось отправить заявку. Попробуйте ещё раз.';
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError('');
    if (step !== 2) return;
    const players = Number(form.players);
    if (!Number.isInteger(players) || players < 1 || players > 20) {
      setStepError('Количество игроков должно быть от 1 до 20.');
      return;
    }
    const payload: ApplicationInput = {
      submissionId,
      name: form.name.trim(),
      contact: form.contact.trim(),
      players,
      format: form.format,
      place: selectedGame ? selectedGame.place : form.place,
      experience: form.experience,
      system: form.system || (selectedGame ? selectedGame.title : form.game),
      genres: form.genres,
      tone: form.tone,
      wishes: form.wishes,
      schedule: form.schedule,
      boundaries: form.boundaries,
      website: form.website,
      consent,
      eventId: selectedGame?.id ?? null,
      occurrenceDate: selectedGame?.date ?? null,
      eventRevision: selectedGame?.revision ?? null,
    };

    try {
      const response = await submitMutation.mutateAsync({ data: payload });
      if (!response.ok) {
        setSubmitError(response.error || 'Мастер не смог принять заявку. Попробуйте ещё раз.');
        return;
      }
      setSent(true);
    } catch (error) {
      setSubmitError(getErrorMessage(error));
    }
  }

  return (
    <Shell>
      <main className="subpage">
        <div className="subpage-head reveal"><div className="eyebrow">первый шаг</div><h1>Вход<br />в <em style={{ color: '#ff716a', fontStyle: 'normal' }}>историю</em></h1><p className="subpage-lead">Расскажи, что ищешь за игровым столом. Анкета ни к чему не обязывает — она помогает мне собрать хорошую группу, где всем будет интересно.</p></div>
        <div className="form-layout">
           <aside className="form-aside"><div className="section-kicker">Что будет дальше</div><p>В течение суток я отвечу тебе в Telegram: уточню детали, расскажу о выбранной игре и познакомлю с форматом.</p><p>Можно написать с нулевым опытом, с готовым персонажем или с идеей, которую давно хочется сыграть.</p><img src="/assets/table.jpg" alt="Игровой стол с кубиками и листами персонажей" loading="lazy" decoding="async" data-testid="img-application-aside" /></aside>
           <div className="form-card">
              {sent ? <div className="success-card" data-testid="application-success"><Check size={25} color="#d8ff55" /><h2>Заявка отправлена</h2><p>Спасибо, {form.name}. Заявка дошла до Никс — она ответит в Telegram в течение суток.</p><div className="hero-actions"><a href="https://t.me/mad_maze_elle" target="_blank" rel="noreferrer" className="button button-primary" data-testid="button-success-telegram">Открыть Telegram <ArrowUpRight size={15} /></a><Link href="/calendar" className="button button-ghost" data-testid="button-success-calendar">Посмотреть календарь <ArrowUpRight size={15} /></Link></div></div> : <form onSubmit={submit} data-testid="application-form">
                <div className="form-card-head"><div><span className="section-kicker">короткая анкета</span><h2>{selectedGame ? <>Заявка<br />на игру</> : <>Пара вопросов<br />перед броском</>}</h2></div><div className="form-step-indicator" aria-label={`Шаг ${step} из 2`}><span className={step === 1 ? 'is-active' : ''}>01<br /><small>контакт</small></span><i aria-hidden="true" /><span className={step === 2 ? 'is-active' : ''}>02<br /><small>детали</small></span></div></div>
                {selectionQuery.isLoading && <div className="form-status" role="status">Проверяю выбранную игру…</div>}
                {selectionQuery.isError && <div className="form-status error" role="alert">Не удалось проверить выбранную игру. Вернитесь в календарь и выберите актуальную дату.</div>}
                {selectedGame && <div className="selected-game" data-testid="selected-game"><span className="section-kicker">Вы выбрали</span><strong>{selectedGame.title}</strong><span>{selectedGame.dateLabel} · {selectedGame.time} · {selectedGame.place}</span><small>{selectedGame.price} · {selectedGame.location}</small></div>}
                 {step === 1 ? <>
                   <div className="field-grid" data-testid="form-step-1"><div className="field"><label htmlFor="name">Как тебя зовут *</label><input id="name" value={form.name} onChange={(event) => update('name', event.target.value)} placeholder="Имя или ник" required data-testid="input-name" /></div><div className="field"><label htmlFor="telegram">Telegram *</label><input id="telegram" value={form.contact} onChange={(event) => update('contact', event.target.value)} placeholder="@username" required data-testid="input-telegram" /></div>{!selectedGame && <div className="field"><label htmlFor="game">Какая игра интересует *</label><select id="game" value={gameChoice} onChange={(event) => selectGame(event.target.value)} disabled={isGamesLoading || catalogQuery.isLoading} required data-testid="select-game"><option value="custom">Хочу обсудить свою идею</option>{catalogItems.map((item) => <option key={`catalog-${item.id}`} value={`catalog:${item.id}`}>{item.title} · {catalogSystem(item.systemKey).title}</option>)}{games.filter(canApply).map((game) => <option key={`${game.id}-${game.dateISO}`} value={`event:${game.eventId}:${game.dateISO}`}>{game.title} · {game.date}</option>)}{!['custom', ...catalogItems.map((item) => `catalog:${item.id}`), ...games.filter(canApply).map((game) => `event:${game.eventId}:${game.dateISO}`)].includes(gameChoice) && form.game !== 'Подобрать игру вместе' && <option value={gameChoice}>{form.game}</option>}</select></div>}<div className="field"><label htmlFor="place">Формат участия</label><select id="place" value={form.place} onChange={(event) => update('place', event.target.value)}><option>Онлайн</option><option>Очно в Москве</option><option>Готовы обсудить</option></select></div><div className="field full"><label htmlFor="schedule">Когда удобно играть *</label><textarea id="schedule" value={form.schedule} onChange={(event) => update('schedule', event.target.value)} placeholder="Дни недели, время, желаемая частота" required /></div></div>
                  {stepError && <div className="form-status error" role="alert">{stepError}</div>}
                  <div className="form-step-actions form-step-actions-next"><button className="button button-primary" type="button" onClick={goToSecondStep} data-testid="button-next-step">Дальше: детали <ArrowUpRight size={15} /></button></div>
                </> : <>
                  <div className="field-grid" data-testid="form-step-2"><div className="field"><label htmlFor="players">Сколько будет игроков *</label><input id="players" type="number" min="1" max="20" value={form.players} onChange={(event) => update('players', event.target.value)} required data-testid="input-players" /></div><div className="field"><label htmlFor="format">Тип игры</label><select id="format" value={form.format} onChange={(event) => update('format', event.target.value)}><option>Ваншот на одну встречу</option><option>Небольшое приключение</option><option>Долгая кампания</option><option>Пока не знаю</option></select></div><div className="field"><label htmlFor="experience">Игровой опыт</label><input id="experience" value={form.experience} onChange={(event) => update('experience', event.target.value)} placeholder="Например: совсем новичок или играю 3 года" /></div><div className="field"><label htmlFor="system">Система или жанр</label><input id="system" value={form.system} onChange={(event) => update('system', event.target.value)} placeholder="Например: D&D 5e, мистика, хоррор" /></div><div className="field"><label htmlFor="genres">Любимые жанры</label><input id="genres" value={form.genres} onChange={(event) => update('genres', event.target.value)} placeholder="Фэнтези, хоррор, детектив…" /></div><div className="field"><label htmlFor="tone">Желаемый тон</label><input id="tone" value={form.tone} onChange={(event) => update('tone', event.target.value)} placeholder="Больше драмы, юмора или экшена" /></div><div className="field full"><label htmlFor="wishes">Что хочется получить от игры</label><textarea id="wishes" value={form.wishes} onChange={(event) => update('wishes', event.target.value)} placeholder="Больше драмы? Исследований? Дурацких шуток в опасном подземелье?" /></div><div className="field full"><label htmlFor="boundaries">Границы и дополнительные детали</label><textarea id="boundaries" value={form.boundaries} onChange={(event) => update('boundaries', event.target.value)} placeholder="Темы, которых лучше избегать, или всё, что важно знать заранее" /></div></div>
                  <div className="form-honeypot" aria-hidden="true"><label htmlFor="website">Не заполняйте это поле</label><input id="website" name="website" value={form.website} onChange={(event) => update('website', event.target.value)} tabIndex={-1} autoComplete="off" /></div>
                  <label className="consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} required /><span>Я согласна, что мои ответы и контакт будут отправлены мастеру в Telegram для обсуждения игры.</span></label>
                  {stepError && <div className="form-status error" role="alert">{stepError}</div>}
                  {submitError && <div className="form-status error" role="alert">{submitError} Можно <a href="https://t.me/mad_maze_elle" target="_blank" rel="noreferrer">написать мастеру в Telegram</a>.</div>}
                  <div className="form-step-actions"><button className="button button-ghost" type="button" onClick={goToFirstStep} data-testid="button-prev-step">Назад</button><button className="button button-primary" type="submit" disabled={submitMutation.isPending || selectionQuery.isLoading || Boolean(selectionQuery.isError) || !consent} data-testid="button-submit-application">{submitMutation.isPending ? 'Отправляю…' : 'Отправить заявку'} <ArrowUpRight size={15} /></button></div>
                </>}
              </form>}
           </div>
        </div>
      </main>
    </Shell>
  );
}

const pageMeta: Record<string, { title: string; description: string }> = {
  '/': {
    title: 'Мадмуазель Никс — настольные ролевые игры онлайн и в Москве',
    description: 'Ваншоты и кампании для новичков и опытных игроков. Онлайн и очно в Москве, группы 3–5 человек.',
  },
  '/calendar': {
    title: 'Календарь игр — Мадмуазель Никс',
    description: 'Ближайшие открытые столы, даты, свободные места и цены на игры Никс.',
  },
  '/calendar/week': {
    title: 'Недельное расписание — Мадмуазель Никс',
    description: 'Недельное расписание игр, открытые наборы и ближайшие встречи Никс.',
  },
  '/games': {
    title: 'Каталог игр — Мадмуазель Никс',
    description: 'D&D, Daggerheart, Vampire и Cyberpunk: выберите мир и формат будущей игры.',
  },
  '/anketa': {
    title: 'Подобрать игру — Мадмуазель Никс',
    description: 'Короткая анкета поможет подобрать систему, сюжет и формат игры под вашу компанию.',
  },
};

function Seo() {
  const [location] = useLocation();
  const pathname = location.split(/[?#]/, 1)[0].replace(/\/+$/, '') || '/';

  useEffect(() => {
    const meta = pageMeta[pathname] ?? pageMeta['/'];
    document.title = meta.title;
    document.documentElement.lang = 'ru';
    document.querySelector('meta[name="description"]')?.setAttribute('content', meta.description);
    document.querySelector('meta[property="og:title"]')?.setAttribute('content', meta.title);
    document.querySelector('meta[property="og:description"]')?.setAttribute('content', meta.description);
    document.querySelector('meta[name="twitter:title"]')?.setAttribute('content', meta.title);
    document.querySelector('meta[name="twitter:description"]')?.setAttribute('content', meta.description);
    const pageUrl = new URL(pathname, window.location.origin).href;
    const imageUrl = new URL('/og.png', window.location.origin).href;
    document.querySelector('meta[property="og:url"]')?.setAttribute('content', pageUrl);
    document.querySelector('meta[property="og:image"]')?.setAttribute('content', imageUrl);
    document.querySelector('meta[name="twitter:image"]')?.setAttribute('content', imageUrl);
    document.querySelector('link[rel="canonical"]')?.setAttribute('href', pageUrl);
  }, [location, pathname]);

  return null;
}

function RouteTransition({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const search = useSearch();
  const routeKey = `${location}${search ? `?${search}` : ''}`;

  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (hash) {
      let targetId = hash;
      try { targetId = decodeURIComponent(hash); } catch { /* Keep malformed hashes harmless. */ }
      requestAnimationFrame(() => document.getElementById(targetId)?.scrollIntoView({ behavior: preferredScrollBehavior(), block: 'start' }));
      return;
    }
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [routeKey]);

  return <div className="route-enter" key={routeKey}>{children}</div>;
}

function Router() {
  const [location] = useLocation();
  const search = useSearch();
  if (location === '/master' || location === '/master/' || location.startsWith('/master/')) return <MasterRoutes />;
  return <ErrorBoundary resetKey={`${location}?${search}`}><Seo /><RouteTransition><Switch><Route path="/" component={Home} /><Route path="/calendar/week" component={() => <CalendarPage initialView="week" />} /><Route path="/calendar" component={() => <CalendarPage initialView="month" />} /><Route path="/anketa" component={ApplicationPage} /><Route path="/games" component={GamesPage} /><Route component={NotFound} /></Switch></RouteTransition></ErrorBoundary>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;
