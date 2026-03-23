import { getDb, dbHelpers } from "../db/index";

const SETTING_KEY = "health-checks:domains";

export interface HealthCheckDomain {
  url: string;
  name: string;
  addedAt: string;
  auto?: boolean;
}

export function getHealthCheckDomains(): HealthCheckDomain[] {
  const db = getDb();
  const raw = dbHelpers.getSetting(db, SETTING_KEY)?.value;
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

export function saveHealthCheckDomains(domains: HealthCheckDomain[]) {
  const db = getDb();
  dbHelpers.setSetting(db, SETTING_KEY, JSON.stringify(domains));
}

/** Auto-register domains when proxy hosts are created */
export function autoRegisterDomains(domainNames: string[]) {
  const domains = getHealthCheckDomains();
  let changed = false;
  for (const name of domainNames) {
    const url = `https://${name}`;
    if (!domains.some((d) => d.url === url)) {
      domains.push({ url, name, addedAt: new Date().toISOString(), auto: true });
      changed = true;
    }
  }
  if (changed) saveHealthCheckDomains(domains);
}

/** Auto-remove domains when proxy hosts are deleted */
export function autoRemoveDomains(domainNames: string[]) {
  const domains = getHealthCheckDomains();
  const urls = new Set(domainNames.map((d) => `https://${d}`));
  const filtered = domains.filter((d) => !urls.has(d.url) || !d.auto);
  if (filtered.length !== domains.length) {
    saveHealthCheckDomains(filtered);
  }
}
