import { getCloudflareSettings, cfFetch, resolveZoneForDomain } from "./cloudflare";
import { logger } from "../lib/logger";
import type { AnalyticsData, AnalyticsBucket, HostAnalyticsSummary } from "@/types";

const CF_GRAPHQL = "https://api.cloudflare.com/client/v4/graphql";

interface GraphQLResponse<T> {
  data: T;
  errors?: Array<{ message: string }>;
}

interface HttpRequestsAdaptiveGroup {
  count: number;
  dimensions: {
    datetimeHour: string;
    clientRequestHTTPHost?: string;
  };
  sum: {
    edgeResponseBytes: number;
  };
  quantiles: Record<string, unknown>;
}

interface StatusMapGroup {
  count: number;
  dimensions: {
    edgeResponseStatus: number;
  };
}

interface TopPathGroup {
  count: number;
  dimensions: {
    clientRequestPath: string;
  };
}

interface TopRefGroup {
  count: number;
  dimensions: {
    clientRequestReferer: string;
  };
}

interface AnalyticsQueryResult {
  viewer: {
    zones: Array<{
      trafficByHour: HttpRequestsAdaptiveGroup[];
      statusBreakdown: StatusMapGroup[];
      topPaths: TopPathGroup[];
      topReferrers: TopRefGroup[];
      uniqueVisitors: Array<{ count: number; dimensions: { datetimeHour: string } }>;
    }>;
  };
}

interface SummaryQueryResult {
  viewer: {
    zones: Array<{
      hostSummary: Array<{
        count: number;
        dimensions: {
          clientRequestHTTPHost: string;
        };
      }>;
      hostErrors: Array<{
        count: number;
        dimensions: {
          clientRequestHTTPHost: string;
        };
      }>;
    }>;
  };
}

async function graphqlQuery<T>(query: string, variables: Record<string, unknown>, apiToken: string): Promise<T | null> {
  try {
    const res = await fetch(CF_GRAPHQL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });

    const json = await res.json() as GraphQLResponse<T>;
    if (json.errors && json.errors.length > 0) {
      logger.warn("cf-analytics", `GraphQL errors: ${json.errors.map(e => e.message).join(", ")}`);
      return null;
    }
    return json.data;
  } catch (err) {
    logger.warn("cf-analytics", `GraphQL request failed: ${err}`);
    return null;
  }
}

function toDateRange(hours: number): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end.getTime() - hours * 60 * 60 * 1000);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

function toDateTimeRange(hours: number): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end.getTime() - hours * 60 * 60 * 1000);
  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

function classifyStatus(status: number): "2xx" | "3xx" | "4xx" | "5xx" | "other" {
  if (status >= 200 && status < 300) return "2xx";
  if (status >= 300 && status < 400) return "3xx";
  if (status >= 400 && status < 500) return "4xx";
  if (status >= 500 && status < 600) return "5xx";
  return "other";
}

export async function getAnalytics(domains: string | string[], hours: number = 24): Promise<AnalyticsData> {
  const domainList = Array.isArray(domains) ? domains : [domains];
  if (domainList.length === 0) return emptyAnalytics();

  const settings = getCloudflareSettings();
  if (!settings.apiToken || settings.zones.length === 0) {
    return emptyAnalytics();
  }

  // Group domains by zone
  const domainsByZone = new Map<string, string[]>();
  for (const domain of domainList) {
    const zone = resolveZoneForDomain(domain, settings.zones);
    if (!zone) continue;
    const list = domainsByZone.get(zone.zoneId) ?? [];
    list.push(domain);
    domainsByZone.set(zone.zoneId, list);
  }

  if (domainsByZone.size === 0) return emptyAnalytics();

  const { start, end } = toDateTimeRange(hours);

  const query = `
    query AnalyticsQuery($zoneTag: string!, $filter: ZoneHttpRequestsAdaptiveGroupsFilter_InputObject!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          trafficByHour: httpRequestsAdaptiveGroups(
            filter: $filter
            limit: 10000
            orderBy: [datetimeHour_ASC]
          ) {
            count
            dimensions {
              datetimeHour
            }
            sum {
              edgeResponseBytes
            }
          }
          statusBreakdown: httpRequestsAdaptiveGroups(
            filter: $filter
            limit: 1000
            orderBy: [count_DESC]
          ) {
            count
            dimensions {
              edgeResponseStatus
            }
          }
          topPaths: httpRequestsAdaptiveGroups(
            filter: $filter
            limit: 20
            orderBy: [count_DESC]
          ) {
            count
            dimensions {
              clientRequestPath
            }
          }
          topReferrers: httpRequestsAdaptiveGroups(
            filter: $filter
            limit: 20
            orderBy: [count_DESC]
          ) {
            count
            dimensions {
              clientRequestReferer
            }
          }
        }
      }
    }
  `;

  // Query each zone in parallel and merge results
  const zoneResults = await Promise.all(
    [...domainsByZone.entries()].map(async ([zoneId, zoneDomains]) => {
      const filter = zoneDomains.length === 1
        ? { datetime_geq: start, datetime_leq: end, clientRequestHTTPHost: zoneDomains[0] }
        : { datetime_geq: start, datetime_leq: end, clientRequestHTTPHost_in: zoneDomains };
      return graphqlQuery<AnalyticsQueryResult>(query, { zoneTag: zoneId, filter }, settings.apiToken);
    })
  );

  // Merge all zone results
  const mergedTraffic: HttpRequestsAdaptiveGroup[] = [];
  const mergedStatus: StatusMapGroup[] = [];
  const mergedPaths: TopPathGroup[] = [];
  const mergedReferrers: TopRefGroup[] = [];

  for (const data of zoneResults) {
    if (!data || !data.viewer.zones[0]) continue;
    const z = data.viewer.zones[0];
    mergedTraffic.push(...z.trafficByHour);
    mergedStatus.push(...z.statusBreakdown);
    mergedPaths.push(...z.topPaths);
    mergedReferrers.push(...z.topReferrers);
  }

  // Use merged data as if it came from a single zone
  const data = mergedTraffic.length > 0 ? {
    viewer: { zones: [{ trafficByHour: mergedTraffic, statusBreakdown: mergedStatus, topPaths: mergedPaths, topReferrers: mergedReferrers, uniqueVisitors: [] }] }
  } : null;

  if (!data || !data.viewer.zones[0]) {
    return emptyAnalytics();
  }

  const zoneData = data.viewer.zones[0];

  // Aggregate traffic by hour into buckets
  const bucketMap = new Map<string, AnalyticsBucket>();
  for (const group of zoneData.trafficByHour) {
    const hour = group.dimensions.datetimeHour;
    const existing = bucketMap.get(hour);
    if (existing) {
      existing.totalRequests += group.count;
      existing.bytesSent += group.sum.edgeResponseBytes;
    } else {
      bucketMap.set(hour, {
        bucket: hour,
        totalRequests: group.count,
        status2xx: 0,
        status3xx: 0,
        status4xx: 0,
        status5xx: 0,
        bytesSent: group.sum.edgeResponseBytes,
        uniqueVisitors: 0,
      });
    }
  }

  // Status breakdown
  let total2xx = 0, total3xx = 0, total4xx = 0, total5xx = 0;
  for (const group of zoneData.statusBreakdown) {
    const cat = classifyStatus(group.dimensions.edgeResponseStatus);
    if (cat === "2xx") total2xx += group.count;
    else if (cat === "3xx") total3xx += group.count;
    else if (cat === "4xx") total4xx += group.count;
    else if (cat === "5xx") total5xx += group.count;
  }

  const buckets = [...bucketMap.values()].sort((a, b) => a.bucket.localeCompare(b.bucket));
  const totalRequests = buckets.reduce((s, b) => s + b.totalRequests, 0);
  const totalBytes = buckets.reduce((s, b) => s + b.bytesSent, 0);
  const errorRequests = total4xx + total5xx;

  // Distribute status counts proportionally to buckets (best-effort)
  for (const b of buckets) {
    const ratio = totalRequests > 0 ? b.totalRequests / totalRequests : 0;
    b.status2xx = Math.round(total2xx * ratio);
    b.status3xx = Math.round(total3xx * ratio);
    b.status4xx = Math.round(total4xx * ratio);
    b.status5xx = Math.round(total5xx * ratio);
  }

  // Top paths (deduplicate across zones)
  const pathMap = new Map<string, number>();
  for (const g of zoneData.topPaths) {
    if (!g.dimensions.clientRequestPath) continue;
    pathMap.set(g.dimensions.clientRequestPath, (pathMap.get(g.dimensions.clientRequestPath) ?? 0) + g.count);
  }
  const topPaths = [...pathMap.entries()]
    .map(([path, count]) => ({ path, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  // Top referrers (deduplicate across zones)
  const refMap = new Map<string, number>();
  for (const g of zoneData.topReferrers) {
    if (!g.dimensions.clientRequestReferer || g.dimensions.clientRequestReferer === "") continue;
    refMap.set(g.dimensions.clientRequestReferer, (refMap.get(g.dimensions.clientRequestReferer) ?? 0) + g.count);
  }
  const topReferrers = [...refMap.entries()]
    .map(([referrer, count]) => ({ referrer, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  return {
    buckets,
    summary: {
      totalRequests,
      status2xx: total2xx,
      status3xx: total3xx,
      status4xx: total4xx,
      status5xx: total5xx,
      bytesSent: totalBytes,
      uniqueVisitors: 0, // CF GraphQL uniqueVisitors requires different dataset
      errorRate: totalRequests > 0 ? Math.round((errorRequests / totalRequests) * 10000) / 100 : 0,
    },
    topPaths,
    topReferrers,
  };
}

export async function getAnalyticsSummary(domainMap: Map<number, string[]>): Promise<HostAnalyticsSummary[]> {
  const settings = getCloudflareSettings();
  if (!settings.apiToken || settings.zones.length === 0) {
    return [];
  }

  const allDomains = [...domainMap.values()].flat();
  if (allDomains.length === 0) return [];

  // Group domains by zone
  const domainsByZone = new Map<string, string[]>(); // zoneId → domains[]
  for (const domain of allDomains) {
    const zone = resolveZoneForDomain(domain, settings.zones);
    if (!zone) continue;
    const list = domainsByZone.get(zone.zoneId) ?? [];
    list.push(domain);
    domainsByZone.set(zone.zoneId, list);
  }

  if (domainsByZone.size === 0) return [];

  const { start, end } = toDateTimeRange(24);

  const query = `
    query SummaryQuery($zoneTag: string!, $filter: ZoneHttpRequestsAdaptiveGroupsFilter_InputObject!, $errorFilter: ZoneHttpRequestsAdaptiveGroupsFilter_InputObject!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          hostSummary: httpRequestsAdaptiveGroups(
            filter: $filter
            limit: 1000
            orderBy: [count_DESC]
          ) {
            count
            dimensions {
              clientRequestHTTPHost
            }
          }
          hostErrors: httpRequestsAdaptiveGroups(
            filter: $errorFilter
            limit: 1000
            orderBy: [count_DESC]
          ) {
            count
            dimensions {
              clientRequestHTTPHost
            }
          }
        }
      }
    }
  `;

  // Query each zone in parallel
  const zoneResults = await Promise.all(
    [...domainsByZone.entries()].map(async ([zoneId, domains]) => {
      const data = await graphqlQuery<SummaryQueryResult>(query, {
        zoneTag: zoneId,
        filter: {
          datetime_geq: start,
          datetime_leq: end,
          clientRequestHTTPHost_in: domains,
        },
        errorFilter: {
          datetime_geq: start,
          datetime_leq: end,
          clientRequestHTTPHost_in: domains,
          edgeResponseStatus_geq: 400,
        },
      }, settings.apiToken);
      return data;
    })
  );

  // Merge results into domain→count maps
  const totalByDomain = new Map<string, number>();
  const errorsByDomain = new Map<string, number>();

  for (const data of zoneResults) {
    if (!data || !data.viewer.zones[0]) continue;
    const zone = data.viewer.zones[0];
    for (const g of zone.hostSummary) {
      const d = g.dimensions.clientRequestHTTPHost;
      totalByDomain.set(d, (totalByDomain.get(d) ?? 0) + g.count);
    }
    for (const g of zone.hostErrors) {
      const d = g.dimensions.clientRequestHTTPHost;
      errorsByDomain.set(d, (errorsByDomain.get(d) ?? 0) + g.count);
    }
  }

  // Map back to proxy host IDs
  const results: HostAnalyticsSummary[] = [];
  for (const [hostId, domains] of domainMap) {
    let total = 0;
    let errors = 0;
    for (const d of domains) {
      total += totalByDomain.get(d) ?? 0;
      errors += errorsByDomain.get(d) ?? 0;
    }
    if (total > 0) {
      results.push({
        proxyHostId: hostId,
        totalRequests: total,
        errorRate: Math.round((errors / total) * 10000) / 100,
      });
    }
  }

  return results;
}

function emptyAnalytics(): AnalyticsData {
  return {
    buckets: [],
    summary: {
      totalRequests: 0,
      status2xx: 0,
      status3xx: 0,
      status4xx: 0,
      status5xx: 0,
      bytesSent: 0,
      uniqueVisitors: 0,
      errorRate: 0,
    },
    topPaths: [],
    topReferrers: [],
  };
}
