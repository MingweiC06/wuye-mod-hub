// China relay: EdgeOne Pages (reachable in mainland China) passes every request
// through to the main site on Cloudflare. Set RELAY_SECRET in the EdgeOne
// project's environment variables (same value as data/relay-secret.txt).
const ORIGIN = 'https://wuye.uniquetalentmap.com';

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const target = ORIGIN + url.pathname + url.search;

  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.set('x-wuye-relay', (env && env.RELAY_SECRET) || '');
  headers.set('x-wuye-host', url.host);
  const ip = (request.eo && request.eo.clientIp) || request.headers.get('x-forwarded-for') || '';
  if (ip) headers.set('x-wuye-client-ip', String(ip).split(',')[0].trim());

  const init = { method: request.method, headers, redirect: 'manual' };
  if (request.method !== 'GET' && request.method !== 'HEAD') init.body = await request.arrayBuffer();

  const res = await fetch(target, init);
  const out = new Headers(res.headers);
  const loc = out.get('location');
  if (loc && loc.startsWith(ORIGIN)) out.set('location', loc.slice(ORIGIN.length) || '/');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out });
}
