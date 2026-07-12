#!/usr/bin/env node
/**
 * AGEnt-YeLL 受け入れテスト自動チェックスクリプト
 *
 * ローカルの静的ファイルを対象に、指示書「Phase 6: 受け入れテスト」の
 * うち機械的に検証可能な項目をチェックする。
 *
 * 実行方法: node scripts/verify-site.js
 *
 * このスクリプトで検証できない項目(手動確認が必要):
 *   - Rich Results Test (Google公式ツールでの実地検証)
 *   - Lighthouse SEO/Accessibility スコア(要 npx lighthouse 等の実行環境)
 *   - form の GAS 送信成功確認(実際のフォーム送信が必要)
 *   - 実際のブラウザでの目視確認
 * これらは DEPLOY.md のチェックリストを参照。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const PAGES = [
  'index.html', 'about/index.html', 'akiya/index.html', 'area/index.html',
  'area/kawanishi/index.html', 'area/amagasaki/index.html', 'area/inagawa/index.html',
  'area/itami/index.html', 'area/kobe/index.html', 'area/kyoto/index.html',
  'area/neyagawa/index.html', 'area/nishinomiya/index.html', 'area/osaka/index.html',
  'area/takarazuka/index.html', 'buyer/index.html', 'for-agent/index.html',
  'form/index.html', 'privacy/index.html', 'sell/index.html', 'staff/koji/index.html',
  'voice/index.html', 'terms/index.html'
];

const AREA_PAGES = [
  'kawanishi', 'amagasaki', 'inagawa', 'itami', 'kobe', 'kyoto',
  'neyagawa', 'nishinomiya', 'osaka', 'takarazuka'
];
const AREA_NAMES = {
  kawanishi: '川西市', amagasaki: '尼崎市', inagawa: '猪名川町', itami: '伊丹市',
  kobe: '神戸市', kyoto: '京都市', neyagawa: '寝屋川市', nishinomiya: '西宮市',
  osaka: '大阪市', takarazuka: '宝塚市'
};

const VALID_TEL = ['0727028043', '09081616489', '07085821364'];

let failures = 0;
let checks = 0;

function pass(msg) { checks++; console.log(`  \x1b[32m✓\x1b[0m ${msg}`); }
function fail(msg) { checks++; failures++; console.log(`  \x1b[31m✗\x1b[0m ${msg}`); }

function section(title) {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

function readPage(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf-8');
}

// ---------- 1. UTF-8 validity / no replacement characters ----------
section('1. 全22ページ UTF-8検証・文字化けチェック');
for (const p of PAGES) {
  const buf = fs.readFileSync(path.join(ROOT, p));
  let valid = true;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch (e) {
    valid = false;
  }
  const text = buf.toString('utf-8');
  const hasReplacementChar = text.includes('�');
  if (valid && !hasReplacementChar) pass(`${p}: valid UTF-8, no mojibake`);
  else fail(`${p}: ${!valid ? 'invalid UTF-8' : 'contains replacement characters'}`);
}

// ---------- 2. tel: links restricted to 3 known values ----------
section('2. tel: リンクがマスターデータの3値のみ');
for (const p of PAGES) {
  const text = readPage(p);
  const matches = [...text.matchAll(/tel:(\d+)/g)].map(m => m[1]);
  const invalid = matches.filter(t => !VALID_TEL.includes(t));
  if (invalid.length === 0) pass(`${p}: tel: OK (${matches.length}件)`);
  else fail(`${p}: 不正なtel値 ${invalid.join(', ')}`);
}
// 090/070 restricted to specific pages
{
  const files090 = PAGES.filter(p => readPage(p).includes('tel:09081616489'));
  const expected090 = ['about/index.html', 'for-agent/index.html'];
  if (files090.length === expected090.length && expected090.every(f => files090.includes(f))) {
    pass(`090番号の掲載範囲が正しい (${files090.join(', ')})`);
  } else {
    fail(`090番号の掲載範囲が想定と異なる: ${files090.join(', ')}`);
  }
  const files070 = PAGES.filter(p => readPage(p).includes('tel:07085821364'));
  if (files070.length === 1 && files070[0] === 'staff/koji/index.html') {
    pass('070番号(瀧直通)はstaff/koji/のみに掲載');
  } else {
    fail(`070番号の掲載範囲が想定と異なる: ${files070.join(', ')}`);
  }
}

// ---------- 3. Area pages: no cross-contamination of other city names ----------
section('3. エリアページへの他地名混入チェック(許可リスト方式)');
for (const slug of AREA_PAGES) {
  const rel = `area/${slug}/index.html`;
  let text = readPage(rel);
  const ownName = AREA_NAMES[slug];
  // "関連エリア" cross-navigation links, and the "位置" geo-description field
  // (e.g. "大阪市に隣接"), legitimately name neighboring cities - strip both
  // before checking for contamination.
  text = text.replace(/<div class="related-btns[^>]*>[\s\S]*?<\/div>/, '');
  text = text.replace(/<div class="info-td">[^<]*(?:隣接|中間)[^<]*<\/div>/, '');
  let contaminated = [];
  for (const [otherSlug, otherName] of Object.entries(AREA_NAMES)) {
    if (otherSlug === slug) continue;
    // Kawanishi is allowed to appear everywhere as the company's registered address
    if (otherName === '川西市') continue;
    if (text.includes(otherName)) contaminated.push(otherName);
  }
  if (contaminated.length === 0) pass(`${rel}: 他地名混入なし(${ownName})`);
  else fail(`${rel}: 他地名混入 -> ${contaminated.join(', ')}`);
}

// ---------- 4. "248" fabricated stat fully removed ----------
section('4. 「248」の一律架空件数表記が排除されていること');
for (const slug of AREA_PAGES) {
  const rel = `area/${slug}/index.html`;
  const text = readPage(rel);
  if (!text.includes('248')) pass(`${rel}: "248"表記なし`);
  else fail(`${rel}: "248"がまだ残っている`);
}

// ---------- 5. Every page footer has the license number ----------
section('5. 全ページフッターに宅建業免許番号が存在');
for (const p of PAGES) {
  const text = readPage(p);
  if (text.includes('第300618号')) pass(`${p}: 免許番号あり`);
  else fail(`${p}: 免許番号が見つからない`);
}

// ---------- 6. form.html: consent checkbox + AI disclaimer (static check) ----------
section('6. form.html: 同意チェックボックス・免責文(静的チェック)');
{
  const text = readPage('form/index.html');
  if (text.includes('id="privacy-consent"') && text.includes('disabled')) {
    pass('form.html: 同意チェックボックスと初期disabledを確認');
  } else {
    fail('form.html: 同意チェックボックス or disabled属性が見つからない');
  }
  if (/document\.getElementById\('assess-submit-btn'\)\.disabled\s*=\s*!this\.checked/.test(text)) {
    pass('form.html: チェック状態に応じたdisabled切替ロジックを確認');
  } else {
    fail('form.html: disabled切替ロジックが見つからない');
  }
  if (text.includes('不動産鑑定評価法に基づく不動産鑑定評価書ではなく')) {
    pass('form.html: AI査定免責文を確認');
  } else {
    fail('form.html: AI査定免責文が見つからない');
  }
  console.log('  \x1b[33m注意\x1b[0m: GAS送信の実成功確認は本番/プレビュー環境での手動テストが必要(DEPLOY.md参照)');
}

// ---------- 7. canonical / OGP / GA4 / Clarity presence on every page ----------
section('7. canonical・OGP・GA4・Clarity の全ページ存在確認');
for (const p of PAGES) {
  const text = readPage(p);
  const hasCanonical = /<link rel="canonical" href="https:\/\/agentyell\.jp\//.test(text);
  const hasOgImage = text.includes('property="og:image"');
  const hasGA4 = (text.match(/G-1JHXRYR3V4/g) || []).length === 2;
  const hasClarity = (text.match(/x9e7w60u34/g) || []).length === 1;
  if (hasCanonical && hasOgImage && hasGA4 && hasClarity) {
    pass(`${p}: canonical/OGP/GA4/Clarity すべて確認`);
  } else {
    fail(`${p}: canonical=${hasCanonical} ogImage=${hasOgImage} GA4=${hasGA4} Clarity=${hasClarity}`);
  }
}

// ---------- 9. Internal link crawl: no dead internal hrefs ----------
section('9. 内部リンク全数チェック(存在しないページへのリンクがないか)');
{
  const existing = new Set();
  for (const p of PAGES) {
    const urlPath = '/' + p.replace(/index\.html$/, '').replace(/\.html$/, '');
    existing.add(urlPath);
  }
  existing.add('/'); // index.html already covered but ensure root
  existing.add('/terms/');

  const hrefRe = /href="(\/[a-zA-Z0-9\-_/]*\/)"/g;
  const allTargets = new Set();
  for (const p of PAGES) {
    const text = readPage(p);
    let m;
    while ((m = hrefRe.exec(text))) allTargets.add(m[1]);
  }
  let deadLinks = [];
  for (const t of allTargets) {
    if (!existing.has(t)) deadLinks.push(t);
  }
  if (deadLinks.length === 0) {
    pass(`内部リンク全て存在するページを指している (${allTargets.size}件のユニークリンクを検査)`);
  } else {
    fail(`存在しないページへのリンク: ${deadLinks.join(', ')}`);
  }
}

// ---------- Summary ----------
console.log(`\n\x1b[1m結果: ${checks - failures}/${checks} 件パス\x1b[0m`);
if (failures > 0) {
  console.log(`\x1b[31m${failures}件の失敗があります\x1b[0m`);
  process.exit(1);
} else {
  console.log('\x1b[32m全チェックパス\x1b[0m');
  process.exit(0);
}
