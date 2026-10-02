export type ApplicationAttribution = Partial<{
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmContent: string;
  utmTerm: string;
}>;

declare global {
  interface Window {
    plausible?: (eventName: string, options?: { props?: Record<string, string> }) => void;
  }
}

const STORAGE_KEY = 'nyx-attribution-v1';
const UTM_FIELDS = [
  ['utm_source', 'utmSource'],
  ['utm_medium', 'utmMedium'],
  ['utm_campaign', 'utmCampaign'],
  ['utm_content', 'utmContent'],
  ['utm_term', 'utmTerm'],
] as const;

let memoryAttribution: ApplicationAttribution = {};
let analyticsInitialized = false;

function fromSearch(search: string): ApplicationAttribution {
  const params = new URLSearchParams(search);
  return Object.fromEntries(UTM_FIELDS.flatMap(([queryKey, field]) => {
    const value = params.get(queryKey)?.trim().slice(0, 100);
    return value ? [[field, value]] : [];
  })) as ApplicationAttribution;
}

export function captureAttribution(search?: string) {
  if (typeof window === 'undefined' || Object.keys(memoryAttribution).length) return;

  try {
    const stored = window.sessionStorage.getItem(STORAGE_KEY);
    if (stored) {
      memoryAttribution = JSON.parse(stored) as ApplicationAttribution;
      return;
    }
  } catch {
    // Continue with the current URL when storage is unavailable.
  }

  memoryAttribution = fromSearch(search ?? window.location.search);
  if (!Object.keys(memoryAttribution).length) return;

  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(memoryAttribution));
  } catch {
    // The in-memory copy remains available for this page session.
  }
}

export function getAttribution(): ApplicationAttribution {
  if (typeof window !== 'undefined' && !Object.keys(memoryAttribution).length) captureAttribution();
  return { ...memoryAttribution };
}

export function initializeAnalytics() {
  if (analyticsInitialized || typeof document === 'undefined') return;
  analyticsInitialized = true;

  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    const link = event.target.closest<HTMLAnchorElement>('a[href]');
    if (link && new URL(link.href, window.location.href).pathname === '/anketa') trackEvent('application_cta_click');
  });

  const domain = (import.meta.env as ImportMetaEnv & { VITE_PLAUSIBLE_DOMAIN?: string }).VITE_PLAUSIBLE_DOMAIN?.trim();
  if (!domain || !/^[a-z0-9.-]+$/i.test(domain)) return;

  const script = document.createElement('script');
  script.defer = true;
  script.dataset.domain = domain;
  script.src = 'https://plausible.io/js/script.js';
  document.head.append(script);
}

export function trackEvent(eventName: string) {
  if (typeof window !== 'undefined') window.plausible?.(eventName);
}
