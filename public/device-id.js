/* ==========================================================================
   乌叶MC · 设备标识 — 180 天滑动有效期（与服务器 wy_vid Cookie 的 180 天一致）
   纯浏览器端，无依赖；页面加载 app.js 之前引入。module.exports 仅用于测试。
   ========================================================================== */
(function (root) {
  'use strict';

  var KEY = 'wy:device';
  var STAMP = 'wy:device:ts';
  var DAYS = 180;
  var TTL = DAYS * 24 * 3600 * 1000;
  var PATTERN = /^[a-z0-9-]{10,64}$/;

  function store() {
    try {
      return root.localStorage;
    } catch {
      return null;
    }
  }
  function read(key) {
    var s = store();
    try {
      return s ? s.getItem(key) : null;
    } catch {
      return null;
    }
  }
  function write(key, value) {
    var s = store();
    try {
      if (s) s.setItem(key, value);
    } catch {
      /* 隐私模式或配额满：本次会话退回内存值（由调用方决定） */
    }
  }
  function drop(key) {
    var s = store();
    try {
      if (s) s.removeItem(key);
    } catch {
      /* 忽略：清除失败时下次读取会按过期处理 */
    }
  }

  function randomHex(bytes) {
    var out = '';
    var i;
    if (root.crypto && root.crypto.getRandomValues) {
      var buffer = new Uint8Array(bytes);
      root.crypto.getRandomValues(buffer);
      for (i = 0; i < buffer.length; i += 1) out += buffer[i].toString(16).padStart(2, '0');
    } else {
      for (i = 0; i < bytes; i += 1) out += Math.floor(Math.random() * 256).toString(16).padStart(2, '0');
    }
    return out;
  }

  function make() {
    return 'd-' + randomHex(12);
  }

  /**
   * 读取（必要时创建/轮换）设备标识。
   * 返回 { id, rotated, adopted }：
   *   rotated=true  —— 没有标识、时间戳过期或时钟异常，生成了新标识
   *   adopted=true  —— 旧版本只存了 id 没存时间戳，沿用旧 id 并从现在开始计时
   */
  function current(now) {
    var clock = typeof now === 'number' ? now : Date.now();
    var id = read(KEY);
    var stamp = Number(read(STAMP));
    var valid = PATTERN.test(id || '');
    var hasStamp = Number.isFinite(stamp) && stamp > 0;

    if (valid && hasStamp) {
      var notFromFuture = stamp <= clock + 24 * 3600 * 1000;
      if (notFromFuture && clock - stamp <= TTL) return { id: id, rotated: false, adopted: false };
      // 过期或时间戳来自未来（改过系统时间）：重新生成，旧投票桶自然留在服务端
    }
    if (valid && !hasStamp) {
      write(STAMP, String(clock));
      return { id: id, rotated: false, adopted: true };
    }

    var next = make();
    write(KEY, next);
    write(STAMP, String(clock));
    return { id: next, rotated: true, adopted: false };
  }

  /** 滑动续期：只更新时间戳，不换 id（提交成功后调用）。 */
  function touch(now) {
    var id = read(KEY);
    if (!PATTERN.test(id || '')) return false;
    write(STAMP, String(typeof now === 'number' ? now : Date.now()));
    return true;
  }

  function reset() {
    drop(KEY);
    drop(STAMP);
  }

  var api = { current: current, touch: touch, reset: reset, ttl: function () { return TTL; }, days: DAYS, KEY: KEY, STAMP: STAMP };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.WYDeviceId = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
