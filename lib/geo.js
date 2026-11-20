/*
 * geo.js — IP location estimates for 安全监控, from the local DB-IP Lite databases.
 *
 * - Fully offline: lookups read DATA_DIR/geo/dbip-city-lite.mmdb and dbip-asn-lite.mmdb on this server.
 *   No visitor IP is ever sent to a third party.
 * - Only fields the database really contains are returned. DB-IP Lite has country, region, city,
 *   approximate city coordinates, and the network's ASN + operator. It has no district, postal code,
 *   ISP-vs-organisation split, connection type or VPN/proxy flags: those are reported as unavailable.
 * - Coordinates are a city-level estimate (rounded to 0.1°, about 10 km). An IP never identifies a home.
 * - Results are cached per IP hash in monitor_geo and deleted together with the IP's records.
 * Attribution required by the CC BY 4.0 licence: "IP Geolocation by DB-IP" (https://db-ip.com).
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { MMDB } from './mmdb.js';

const CN_REGIONS = {
  Beijing: '北京', Tianjin: '天津', Shanghai: '上海', Chongqing: '重庆', Hebei: '河北', Shanxi: '山西', 'Inner Mongolia': '内蒙古',
  Liaoning: '辽宁', Jilin: '吉林', Heilongjiang: '黑龙江', Jiangsu: '江苏', Zhejiang: '浙江', Anhui: '安徽', Fujian: '福建', Jiangxi: '江西',
  Shandong: '山东', Henan: '河南', Hubei: '湖北', Hunan: '湖南', Guangdong: '广东', Guangxi: '广西', 'Guangxi Zhuang Autonomous Region': '广西',
  Hainan: '海南', Sichuan: '四川', Guizhou: '贵州', Yunnan: '云南', Tibet: '西藏', Xizang: '西藏', Shaanxi: '陕西', Gansu: '甘肃', Qinghai: '青海',
  Ningxia: '宁夏', 'Ningxia Hui Autonomous Region': '宁夏', Xinjiang: '新疆', 'Xinjiang Uyghur Autonomous Region': '新疆', 'Inner Mongolia Autonomous Region': '内蒙古',
  'Hong Kong': '香港', Macao: '澳门', Macau: '澳门', Taiwan: '台湾',
};

export function migrateGeo(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS monitor_geo (
      ip_hash    TEXT PRIMARY KEY,
      data       TEXT    NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
}

/** Country code → flag emoji (regional indicator letters). */
export function flagOf(code) {
  return /^[A-Z]{2}$/.test(code || '') ? String.fromCodePoint(...[...code].map((c) => 0x1f1a5 + c.charCodeAt(0))) : '';
}

/** Addresses that are never in a geolocation database. */
function special(ip) {
  const s = String(ip || '').replace(/^::ffff:/i, '');
  if (net.isIP(s) === 4) {
    const [a, b] = s.split('.').map(Number);
    if (a === 198 && (b === 18 || b === 19)) return '测试用假地址（198.18.0.0/15，预览环境）';
    if (a === 192 && b === 0) return '文档示例地址（不对应真实位置）';
    if ((a === 198 && b === 51) || (a === 203 && b === 0)) return '文档示例地址（不对应真实位置）';
    if (a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return '内网 / 本机地址（不对应公网位置）';
    if (a === 100 && b >= 64 && b <= 127) return '运营商内部地址（CGNAT）';
  } else if (net.isIP(s) === 6) {
    if (/^(::1|fe80:|fc|fd)/i.test(s)) return '内网 / 本机地址（不对应公网位置）';
    if (/^2001:0?db8:/i.test(s)) return '文档示例地址（不对应真实位置）';
  }
  return '';
}

export function createGeo(dataDir, { dir } = {}) {
  const geoDir = dir || path.join(dataDir, 'geo');
  let city = null;
  let asn = null;
  let openedAt = 0;
  let error = '';

  function open() {
    // Re-open at most once an hour so a monthly database refresh is picked up without a restart.
    if (Date.now() - openedAt < 3600_000) return;
    openedAt = Date.now();
    for (const [name, set] of [
      ['dbip-city-lite.mmdb', (v) => (city = v)],
      ['dbip-asn-lite.mmdb', (v) => (asn = v)],
    ]) {
      const file = path.join(geoDir, name);
      try {
        if (fs.existsSync(file)) set(new MMDB(file));
        else set(null);
        error = '';
      } catch (e) {
        set(null);
        error = String(e.message || e);
      }
    }
  }

  function status() {
    open();
    const built = (m) => (m ? new Date(m.metadata.build_epoch * 1000).toISOString().slice(0, 10) : '');
    return { city: Boolean(city), asn: Boolean(asn), cityBuilt: built(city), asnBuilt: built(asn), error };
  }

  /** Full estimate for one IP. Every field is either from the database or explicitly null. */
  function lookup(ip) {
    open();
    const now = Date.now();
    const base = {
      ip,
      found: false,
      note: '',
      countryCode: null,
      country: null,
      flag: '',
      region: null,
      city: null,
      district: null,
      postalCode: null,
      lat: null,
      lon: null,
      accuracy: null,
      asn: null,
      org: null,
      isp: null,
      connectionType: null,
      vpnProxy: null,
      provider: city ? `DB-IP Lite（${status().cityBuilt} 版，本地数据库）` : '未安装地理位置数据库',
      updatedAt: now,
    };
    const sp = special(ip);
    if (sp) return { ...base, note: sp };
    if (!city && !asn) return { ...base, note: '服务器上还没有地理位置数据库' };
    let c = null;
    let a = null;
    try {
      c = city ? city.lookup(ip) : null;
      a = asn ? asn.lookup(ip) : null;
    } catch {
      return { ...base, note: '查询失败' };
    }
    const d = c ? c.data : {};
    const code = d.country?.iso_code || null;
    const regionEn = d.subdivisions?.[0]?.names?.en || null;
    const loc = d.location || {};
    return {
      ...base,
      found: Boolean(c || a),
      note: c || a ? '' : '数据库里没有这个地址',
      countryCode: code,
      country: d.country?.names?.['zh-CN'] || d.country?.names?.en || null,
      flag: flagOf(code),
      region: regionEn ? (code === 'CN' || code === 'HK' || code === 'MO' || code === 'TW' ? CN_REGIONS[regionEn] || regionEn : regionEn) : null,
      city: d.city?.names?.en || null,
      lat: Number.isFinite(loc.latitude) ? Math.round(loc.latitude * 10) / 10 : null,
      lon: Number.isFinite(loc.longitude) ? Math.round(loc.longitude * 10) / 10 : null,
      accuracy: c ? '城市级估算：可能偏差几十公里，移动网络、VPN 或代理会让它显示成别的城市甚至别的国家' : null,
      asn: a?.data?.autonomous_system_number ? `AS${a.data.autonomous_system_number}` : null,
      org: a?.data?.autonomous_system_organization || null,
    };
  }

  /** Cached lookup keyed by the IP's hash. */
  function cached(db, ipHash, ip) {
    const row = db.prepare('SELECT data, updated_at FROM monitor_geo WHERE ip_hash = ?').get(ipHash);
    if (row && Date.now() - Number(row.updated_at) < 30 * 86400_000) {
      try {
        return { ...JSON.parse(row.data), ip };
      } catch {}
    }
    const g = lookup(ip);
    const { ip: _drop, ...store } = g;
    db.prepare('INSERT INTO monitor_geo (ip_hash, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(ip_hash) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at').run(ipHash, JSON.stringify(store), g.updatedAt);
    return g;
  }

  return { lookup, cached, status, dir: geoDir };
}

/** "Guangzhou, 广东, 中国" — only the parts that exist. */
export function placeLabel(g) {
  if (!g) return '';
  if (!g.found) return g.note || '';
  const parts = [g.city, g.region && g.region !== g.city ? g.region : null, g.country].filter(Boolean);
  return parts.join(', ');
}
