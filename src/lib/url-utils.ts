/** Convert SSH git URL to HTTPS URL */
export function toHttpsUrl(url: string): string {
  const m = url.match(/^git@([^:]+):([^/]+)\/(.+?)(?:\.git)?$/);
  if (m) return `https://${m[1]}/${m[2]}/${m[3]}`;
  return url.replace(/\.git$/, "");
}

/** Convert HTTPS URL to SSH git URL */
export function toSshUrl(url: string): string {
  const m = url.match(/https?:\/\/([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (m) return `git@${m[1]}:${m[2]}/${m[3]}.git`;
  return url;
}

/** Check if URL is SSH format */
export function isSshUrl(url: string): boolean {
  return /^git@/.test(url);
}

/** Check if URL is HTTPS format */
export function isHttpsUrl(url: string): boolean {
  return /^https?:\/\//.test(url);
}
