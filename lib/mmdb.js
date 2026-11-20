/*
 * mmdb.js — minimal reader for MaxMind DB files (.mmdb), the format DB-IP Lite ships in.
 * Zero dependencies. Reads the file with positioned reads through a small page cache, so a
 * 130 MB database costs a few hundred KB of memory. Lookups are local: no IP leaves the server.
 * Format reference: https://maxmind.github.io/MaxMind-DB/
 */
import fs from 'node:fs';
import net from 'node:net';

const MARKER = Buffer.from('abcdef4d61784d696e642e636f6d', 'hex'); // \xAB\xCD\xEF + "MaxMind.com"
const PAGE = 4096;

export class MMDB {
  constructor(file) {
    this.fd = fs.openSync(file, 'r');
    this.size = fs.fstatSync(this.fd).size;
    this.pages = new Map();
    // Metadata: the last occurrence of the marker, within the final 128 KB.
    const tailLen = Math.min(this.size, 128 * 1024);
    const tail = Buffer.alloc(tailLen);
    fs.readSync(this.fd, tail, 0, tailLen, this.size - tailLen);
    const at = tail.lastIndexOf(MARKER);
    if (at < 0) throw new Error('not an mmdb file');
    this.dataBase = 0;
    this.metaBase = this.size - tailLen + at + MARKER.length;
    this.metadata = this.decode(this.metaBase, this.metaBase).value;
    const m = this.metadata;
    this.nodeCount = m.node_count;
    this.recordSize = m.record_size;
    if (![24, 28, 32].includes(this.recordSize)) throw new Error('unsupported record size');
    this.nodeBytes = this.recordSize / 4;
    this.treeSize = this.nodeBytes * this.nodeCount;
    this.dataBase = this.treeSize + 16;
    // IPv4 addresses live under ::/96 in an IPv6 tree.
    this.v4Start = 0;
    if (m.ip_version === 6) {
      let node = 0;
      for (let i = 0; i < 96 && node < this.nodeCount; i += 1) node = this.record(node, 0);
      this.v4Start = node;
    }
  }

  close() {
    try {
      fs.closeSync(this.fd);
    } catch {}
  }

  byte(off) {
    const p = Math.floor(off / PAGE);
    let page = this.pages.get(p);
    if (!page) {
      page = Buffer.alloc(PAGE);
      fs.readSync(this.fd, page, 0, PAGE, p * PAGE);
      if (this.pages.size > 256) this.pages.delete(this.pages.keys().next().value);
      this.pages.set(p, page);
    }
    return page[off - p * PAGE];
  }

  bytes(off, n) {
    const out = Buffer.alloc(n);
    for (let i = 0; i < n; i += 1) out[i] = this.byte(off + i);
    return out;
  }

  uint(off, n) {
    let v = 0;
    for (let i = 0; i < n; i += 1) v = v * 256 + this.byte(off + i);
    return v;
  }

  record(node, bit) {
    const off = node * this.nodeBytes;
    if (this.recordSize === 24) return this.uint(off + bit * 3, 3);
    if (this.recordSize === 32) return this.uint(off + bit * 4, 4);
    // 28-bit: the middle byte's nibbles are the high bits of each record.
    const mid = this.byte(off + 3);
    return bit === 0 ? ((mid & 0xf0) << 20) + this.uint(off, 3) : ((mid & 0x0f) << 24) + this.uint(off + 4, 3);
  }

  /** Returns { data, prefixLength } or null when the IP is not in the database. */
  lookup(ip) {
    const kind = net.isIP(String(ip || ''));
    if (!kind) return null;
    const bits = kind === 4 ? v4Bits(ip) : v6Bits(ip);
    if (!bits) return null;
    let node = kind === 4 ? this.v4Start : 0;
    let i = 0;
    for (; i < bits.length && node < this.nodeCount; i += 1) node = this.record(node, bits[i]);
    if (node === this.nodeCount || node < this.nodeCount) return null;
    const off = node - this.nodeCount - 16 + this.dataBase;
    return { data: this.decode(off, this.dataBase).value, prefixLength: kind === 4 && this.metadata.ip_version === 6 ? i : i };
  }

  /** Decodes one value at `off`; pointers are relative to `base`. Returns { value, next }. */
  decode(off, base) {
    const ctrl = this.byte(off);
    off += 1;
    let type = ctrl >> 5;
    if (type === 1) {
      const ss = (ctrl >> 3) & 3;
      const vvv = ctrl & 7;
      let ptr;
      if (ss === 0) ptr = vvv * 256 + this.byte(off);
      else if (ss === 1) ptr = vvv * 65536 + this.uint(off, 2) + 2048;
      else if (ss === 2) ptr = vvv * 16777216 + this.uint(off, 3) + 526336;
      else ptr = this.uint(off, 4);
      return { value: this.decode(base + ptr, base).value, next: off + ss + 1 };
    }
    if (type === 0) {
      type = 7 + this.byte(off);
      off += 1;
    }
    let size = ctrl & 0x1f;
    if (size === 29) {
      size = 29 + this.byte(off);
      off += 1;
    } else if (size === 30) {
      size = 285 + this.uint(off, 2);
      off += 2;
    } else if (size === 31) {
      size = 65821 + this.uint(off, 3);
      off += 3;
    }
    switch (type) {
      case 2:
        return { value: this.bytes(off, size).toString('utf8'), next: off + size };
      case 3:
        return { value: this.bytes(off, 8).readDoubleBE(0), next: off + 8 };
      case 4:
        return { value: this.bytes(off, size), next: off + size };
      case 5:
      case 6:
      case 9:
      case 10:
        return { value: size ? (size > 6 ? Number(BigInt('0x' + this.bytes(off, size).toString('hex'))) : this.uint(off, size)) : 0, next: off + size };
      case 7: {
        const obj = {};
        for (let i = 0; i < size; i += 1) {
          const k = this.decode(off, base);
          const v = this.decode(k.next, base);
          obj[k.value] = v.value;
          off = v.next;
        }
        return { value: obj, next: off };
      }
      case 8: {
        const b = Buffer.alloc(4);
        this.bytes(off, size).copy(b, 4 - size);
        return { value: b.readInt32BE(0), next: off + size };
      }
      case 11: {
        const arr = [];
        for (let i = 0; i < size; i += 1) {
          const v = this.decode(off, base);
          arr.push(v.value);
          off = v.next;
        }
        return { value: arr, next: off };
      }
      case 14:
        return { value: size !== 0, next: off };
      case 15:
        return { value: this.bytes(off, 4).readFloatBE(0), next: off + 4 };
      default:
        throw new Error(`mmdb: unknown type ${type}`);
    }
  }
}

function v4Bits(ip) {
  const parts = ip.split('.').map(Number);
  const bits = [];
  for (const p of parts) for (let i = 7; i >= 0; i -= 1) bits.push((p >> i) & 1);
  return bits;
}

function v6Bits(ip) {
  let s = ip.toLowerCase();
  // ::ffff:1.2.3.4 style
  const v4 = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const p = v4[2].split('.').map(Number);
    s = v4[1] + ((p[0] << 8) | p[1]).toString(16) + ':' + ((p[2] << 8) | p[3]).toString(16);
  }
  const [head, tail] = s.split('::');
  const h = head ? head.split(':') : [];
  const t = tail !== undefined && tail ? tail.split(':') : [];
  const groups = tail !== undefined ? [...h, ...Array(8 - h.length - t.length).fill('0'), ...t] : h;
  if (groups.length !== 8) return null;
  const bits = [];
  for (const g of groups) {
    const n = parseInt(g || '0', 16);
    for (let i = 15; i >= 0; i -= 1) bits.push((n >> i) & 1);
  }
  return bits;
}
