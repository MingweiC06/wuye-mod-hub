#!/usr/bin/env node
/**
 * scripts/bump-asset-versions.mjs — 资产版本号（缓存破活）统一升级脚本，零依赖。
 *
 * 背景：站点把 *.css / *.js / *.woff2 以 `Cache-Control: public, max-age=86400`
 * 发出去（见 lib/http.js），HTML 里靠 `?v=...` 手动破缓存。每次改样式/脚本都要
 * 逐页改版本号，容易漏。本脚本把所有已经带 `?v=` 的同源 CSS/JS/WOFF2 引用
 * 一次性换成同一个新版本号。
 *
 * 用法（脚本自动定位项目根 = scripts/ 的上一级）：
 *   node scripts/bump-asset-versions.mjs                 # 默认 dry-run：只打印，不写文件
 *   node scripts/bump-asset-versions.mjs --apply         # 真正写入 public/**\/*.html
 *   node scripts/bump-asset-versions.mjs --stamp=20261118-2301
 *   node scripts/bump-asset-versions.mjs --root=<dir>    # 扫描 <dir>/public（测试用）
 *   node scripts/bump-asset-versions.mjs --help
 *
 * 规则（刻意保守）：
 *   1. 只扫 public/ 下所有 .html（递归）；
 *   2. 只看 href / src 属性里、且扩展名是 .css / .js / .woff2 的引用；
 *   3. 只替换【已存在】的 v 参数的值，绝不新增、不删除、不重排任何参数；
 *   4. http(s)://、//、data:、mailto: 等外部或非路径引用一律跳过；
 *   5. 写盘前自检：把版本号归一化后新旧内容必须逐字节相同，否则中止且不写；
 *   6. 不联网、不碰 data/、不碰数据库、不改 HTML 结构。
 *
 * 版本号格式：YYYYMMDD-HHMM，按站点惯例用 UTC+8。同一分钟内重复执行结果相同，
 * 因此脚本可以放心重跑（已是最新时只提示、不写盘）。
 *
 * 退出码：0 成功（含 dry-run 与“已是最新”）；1 参数错误或自检/读写失败。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSET_EXT = new Set(['.css', '.js', '.woff2']);
const STAMP_PATTERN = /^\d{8}-\d{4}$/;
const MAX_HTML_BYTES = 4 * 1024 * 1024;

/** href / src 属性（排除 data-src 之类的自定义属性）。 */
const ATTRIBUTE_PATTERN = /(?<![\w-])(href|src)(\s*=\s*)(["'])([^"']*)\3/gi;
/** 用于自检时把版本号抹平。 */
const VERSION_PATTERN = /\bv=[^"'&\s>]*/g;

function usage() {
  return [
    '乌叶MC · 资产版本号统一升级',
    '',
    '  node scripts/bump-asset-versions.mjs [--apply] [--stamp=YYYYMMDD-HHMM] [--root=<dir>]',
    '',
    '  （默认 dry-run，只列出将要修改的内容，不写任何文件）',
    '  --apply              写入 public/**/*.html',
    '  --stamp=<版本号>      指定统一版本号，格式 YYYYMMDD-HHMM；默认当前 UTC+8 时间',
    '  --root=<目录>         把 <目录>/public 当作扫描目标（测试用，默认项目根）',
    '  --help, -h           显示本帮助',
    '',
    '  只改已经带 ?v= 的 .css / .js / .woff2 引用，不新增参数、不改其他任何内容。',
  ].join('\n');
}

/** 解析命令行参数；未知参数直接报错，避免手滑打错时静默 dry-run。 */
function parseArgs(argv) {
  const options = { apply: false, stamp: null, root: null, help: false };
  for (const arg of argv) {
    if (arg === '--apply') {
      options.apply = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg.startsWith('--stamp=')) {
      options.stamp = arg.slice('--stamp='.length).trim();
    } else if (arg.startsWith('--root=')) {
      options.root = arg.slice('--root='.length).trim();
    } else {
      throw new Error(`无法识别的参数：${arg}\n\n${usage()}`);
    }
  }
  return options;
}

/** 当前版本号：YYYYMMDD-HHMM（UTC+8，与站点时间显示惯例一致）。 */
function stampNow(now = Date.now()) {
  const shifted = new Date(now + 8 * 3600_000);
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${shifted.getUTCFullYear()}${pad(shifted.getUTCMonth() + 1)}${pad(shifted.getUTCDate())}` +
    `-${pad(shifted.getUTCHours())}${pad(shifted.getUTCMinutes())}`
  );
}

/** 递归收集 .html 文件，排序保证输出稳定。 */
function collectHtml(dir) {
  const found = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.html')) {
        found.push(full);
      }
    }
  };
  walk(dir);
  return found.sort((a, b) => a.localeCompare(b, 'en'));
}

/**
 * 判断一个属性值是不是“同源、带 ?v= 的 CSS/JS/WOFF2”。
 * 返回 { next } 或 null（null = 不处理这个引用）。
 */
function bumpUrl(raw, stamp) {
  if (!raw) return null;
  // 外部地址、协议相对地址、data:/mailto: 等：跳过。
  if (raw.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(raw)) return null;
  const queryAt = raw.indexOf('?');
  if (queryAt < 0) return null;
  const pathname = raw.slice(0, queryAt);
  const extension = path.posix.extname(pathname.split('#')[0]).toLowerCase();
  if (!ASSET_EXT.has(extension)) return null;

  const params = raw.slice(queryAt + 1).split('&');
  let replaced = 0;
  const nextParams = params.map((param) => {
    if (param.startsWith('v=')) {
      replaced += 1;
      return `v=${stamp}`;
    }
    return param;
  });
  if (replaced === 0) return null; // 没有 ?v= 就不加，保持现状
  const next = `${pathname}?${nextParams.join('&')}`;
  return {
    next,
    duplicate: replaced > 1,
    same: next === raw,
  };
}

/** 自检：抹平版本号之后，新旧内容必须完全一致。 */
function normalizeVersions(text) {
  return text.replace(VERSION_PATTERN, 'v=*');
}

function flatten(text) {
  return text.replace(/\r\n/g, '\n');
}

/** 同源 CSS/JS/WOFF2 引用（不含外部地址），用于统计“没有 ?v=”的漏网资源。 */
function isInternalAsset(raw) {
  if (!raw || raw.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(raw)) return false;
  return ASSET_EXT.has(path.posix.extname(raw.split('?')[0].split('#')[0]).toLowerCase());
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const root = options.root ? path.resolve(options.root) : ROOT;
  const publicDir = path.join(root, 'public');
  if (!fs.existsSync(publicDir) || !fs.statSync(publicDir).isDirectory()) {
    throw new Error(`找不到 public 目录：${publicDir}`);
  }

  const stamp = options.stamp || stampNow();
  if (!STAMP_PATTERN.test(stamp)) {
    throw new Error(`版本号格式不对："${stamp}"，应为 YYYYMMDD-HHMM，例如 20261118-2301。`);
  }

  const htmlFiles = collectHtml(publicDir);
  if (htmlFiles.length === 0) {
    throw new Error(`public 目录下没有 .html 文件：${publicDir}`);
  }

  console.log('乌叶MC · 资产版本号统一升级');
  console.log(`  模式      ${options.apply ? 'apply（写入）' : 'dry-run（只预览，不写盘）'}`);
  console.log(`  版本号    ${stamp}`);
  console.log(`  扫描范围  ${path.relative(root, publicDir) || '.'}/**/*.html（${htmlFiles.length} 个文件）`);

  const changes = [];
  let untouchedAssetRefs = 0;
  let duplicateWarnings = 0;
  let totalRefs = 0;

  for (const file of htmlFiles) {
    const relative = path.relative(root, file).split(path.sep).join('/');
    const stats = fs.statSync(file);
    if (stats.size > MAX_HTML_BYTES) {
      throw new Error(`文件过大，已跳过以免误伤：${relative}（${stats.size} 字节）`);
    }
    const before = fs.readFileSync(file, 'utf8');
    const perFile = [];

    const after = before.replace(ATTRIBUTE_PATTERN, (match, name, equals, quote, value) => {
      const result = bumpUrl(value, stamp);
      if (!result) {
        if (isInternalAsset(value) && !value.includes('?v=')) untouchedAssetRefs += 1;
        return match;
      }
      if (result.duplicate) duplicateWarnings += 1;
      if (result.same) return match;
      perFile.push({ from: value, to: result.next });
      return `${name}${equals}${quote}${result.next}${quote}`;
    });

    if (perFile.length === 0) continue;

    if (flatten(normalizeVersions(after)) !== flatten(normalizeVersions(before))) {
      throw new Error(
        `自检失败：${relative} 中除版本号外还有别的改动，已中止，未写入任何文件。`,
      );
    }

    changes.push({ file, relative, after, references: perFile });
    totalRefs += perFile.length;
  }

  if (changes.length === 0) {
    console.log('');
    console.log(`已是最新：${htmlFiles.length} 个 HTML 里没有需要替换的版本号（目标 ${stamp}）。`);
    if (untouchedAssetRefs > 0) {
      console.log(`（另有 ${untouchedAssetRefs} 处 CSS/JS/WOFF2 引用本来就没有 ?v=，按规则不新增参数。）`);
    }
    return;
  }

  for (const change of changes) {
    console.log('');
    console.log(`${change.relative}  （${change.references.length} 处）`);
    for (const reference of change.references) {
      console.log(`  ${reference.from}  ->  ${reference.to}`);
    }
  }

  if (options.apply) {
    for (const change of changes) {
      fs.writeFileSync(change.file, change.after, 'utf8');
    }
  }

  console.log('');
  console.log(
    `汇总：${changes.length} 个文件 / ${totalRefs} 处引用` +
      (duplicateWarnings ? `（其中 ${duplicateWarnings} 处原本就有重复的 v 参数，已一并统一）` : ''),
  );
  if (untouchedAssetRefs > 0) {
    console.log(`另有 ${untouchedAssetRefs} 处 CSS/JS/WOFF2 引用本来就没有 ?v=，按规则未改动。`);
  }

  if (options.apply) {
    console.log('');
    console.log('已写入，下一步建议：');
    console.log(`  git diff --stat public/    # 确认只有 HTML 里的版本号变化`);
    console.log(`  npm test                   # 页面资源引用仍应全部 200`);
    console.log('  git add -A public/ scripts/ && git commit -m "Bump asset versions"');
  } else {
    console.log('');
    console.log('未写入任何文件。确认上面的清单无误后，加上 --apply 再执行一次。');
  }
}

try {
  main();
} catch (error) {
  console.error('');
  console.error(`升级失败：${error.message}`);
  process.exitCode = 1;
}
