#!/usr/bin/env node
/*
 * スプレッドシート(Apps Script API)の「物件」「ブログ」「口コミ」から、静的ページを作る。
 *   - /sell/ の物件一覧、/sell/<管理番号>/ の物件詳細
 *   - /blog/ の記事一覧、/blog/<記事ID>/ の記事
 *   - /voice/ の口コミ(承認済み)
 *   - sitemap.xml
 * Vercel のビルド時に実行する(毎朝・手動の再デプロイで最新になる)。
 * API が取得できないときは、今あるページをそのまま使う(サイトは止まらない)。
 *
 * 環境変数:
 *   CMS_API_URL      Apps Script のウェブアプリURL(省略時は本番)
 *   CMS_OUT          出力先フォルダ(省略時はリポジトリ直下。試すときは _preview など)
 *   CMS_FIXTURE      API の代わりに使う JSON のフォルダ(properties.json / posts.json / reviews.json)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = process.env.CMS_OUT ? path.resolve(process.env.CMS_OUT) : ROOT;
const API = process.env.CMS_API_URL ||
  'https://script.google.com/macros/s/AKfycbznHcSClJjF6sqtZpcuzamX5Az1TSvjYMVKP4UPSVOqK7FEQK6VFmyNT2Z_EHiW8JG0/exec';
const SITE = 'https://agentyell.jp';
const ORG = 'AGEnt-YeLL エージェントエール';

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const jld = (o) => '<script type="application/ld+json">' + JSON.stringify(o).replace(/</g, '\\u003c') + '</script>';
const jpDate = (d) => (d && /^\d{4}-\d{2}-\d{2}/.test(d)) ? `${+d.slice(0, 4)}年${+d.slice(5, 7)}月${+d.slice(8, 10)}日` : '';
const safeId = (p) => /^[A-Za-z0-9][A-Za-z0-9_-]{0,78}$/.test(String(p.id));
const num = (n) => (n == null || n === '') ? '' : Number(n).toLocaleString('ja-JP');

// ---------- データ取得 ----------
async function getJson(api, extra) {
  if (process.env.CMS_FIXTURE) {
    return JSON.parse(fs.readFileSync(path.join(process.env.CMS_FIXTURE, api + '.json'), 'utf8'));
  }
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(`${API}?api=${api}${extra || ''}`, { redirect: 'follow', signal: AbortSignal.timeout(90000) });
      const j = await res.json();
      if (j && j.ok && Array.isArray(j.items)) return j;
      lastErr = new Error('bad response: ' + JSON.stringify(j).slice(0, 120));
    } catch (e) { lastErr = e; }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw lastErr;
}

// ---------- 出力先の準備 ----------
function prepareOut() {
  if (OUT === ROOT) return;
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.cpSync(ROOT, OUT, { recursive: true, filter: (src) => {
    const rel = path.relative(ROOT, src);
    return !(rel.startsWith('.git') || rel.startsWith('node_modules') || rel.startsWith('_preview') || (OUT.startsWith(ROOT) && src === OUT));
  } });
}
const rd = (p) => fs.readFileSync(path.join(OUT, p), 'utf8');
const wr = (p, s) => { const f = path.join(OUT, p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };

// 目印(<!--CMS:X-->…<!--/CMS:X-->)の間を差し替える
function inject(html, name, content) {
  const a = `<!--CMS:${name}-->`, b = `<!--/CMS:${name}-->`;
  const i = html.indexOf(a), j = html.indexOf(b);
  if (i < 0 || j < 0) throw new Error(`marker ${name} not found`);
  return html.slice(0, i + a.length) + '\n' + content + '\n' + html.slice(j);
}

// ---------- ページの枠(売物件ページの head / header / footer をそのまま使う) ----------
let TPL = null;
function loadTemplate() {
  const src = fs.readFileSync(path.join(ROOT, 'sell/index.html'), 'utf8');
  let head = src.slice(0, src.indexOf('</head>'));
  head = head.replace(/<title>[\s\S]*?<\/title>/, '')
    .replace(/<meta name="description"[^>]*>/, '')
    .replace(/<link rel="canonical"[^>]*>/, '')
    .replace(/<meta property="og:[^>]*>/g, '')
    .replace(/<meta name="twitter:[^>]*>/g, '')
    .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, '');
  const header = (src.match(/<header>[\s\S]*?<\/header>/) || [''])[0];
  const footer = (src.match(/<!-- Float Button Container -->[\s\S]*?<\/footer>/) || [''])[0];
  const script = (src.match(/<script>\s*\/\/ Float Button[\s\S]*?<\/script>/) || [''])[0];
  const bodyTag = '<body>';
  TPL = { head, header, footer, script, bodyTag };
}

function page({ title, desc, path: p, image, ld, main, noindex, type }) {
  const url = SITE + p, img = image || SITE + '/assets/og.png';
  const meta = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(desc)}">`,
    `<link rel="canonical" href="${url}">`,
    noindex ? '<meta name="robots" content="noindex,follow">' : '',
    `<meta property="og:type" content="${type || 'website'}">`,
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
    `<meta property="og:image" content="${esc(img)}">`,
    `<meta property="og:site_name" content="${ORG}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(desc)}">`,
    `<meta name="twitter:image" content="${esc(img)}">`,
    '<link rel="stylesheet" href="/assets/cms.css">',
    (ld || []).map(jld).join('\n'),
  ].filter(Boolean).join('\n');
  return `${TPL.head}\n${meta}\n</head>\n${TPL.bodyTag}\n${TPL.header}\n<main>\n${main}\n</main>\n${TPL.footer}\n${TPL.script}\n</body>\n</html>\n`;
}

const crumbLd = (items) => ({ '@context': 'https://schema.org', '@type': 'BreadcrumbList',
  itemListElement: items.map((x, i) => ({ '@type': 'ListItem', position: i + 1, name: x[0], item: SITE + x[1] })) });

// ---------- 物件 ----------
const STATUS_CLASS = { '販売中': '', '商談中': ' talk', '成約済': ' sold' };

function propCard(p) {
  const sold = p.status === '成約済';
  const href = sold ? null : `/sell/${encodeURIComponent(p.id)}/`;
  const img = p.mainPhoto
    ? `<img src="${esc(p.mainPhoto)}" alt="${esc(p.name)}" loading="lazy" referrerpolicy="no-referrer">`
    : '<div class="cms-card-noimg">写真準備中</div>';
  const area = p.landArea ? `土地 ${num(p.landArea)}㎡` : '';
  const bld = p.bldgArea ? `建物 ${num(p.bldgArea)}㎡` : '';
  const specs = [
    ['所在地', p.address], ['種別', p.type], ['面積', [area, bld].filter(Boolean).join(' / ')],
    sold ? ['成約日', jpDate(p.soldDate)] : ['交通', p.access],
  ].filter((x) => x[1]).map((x) => `<li><b>${x[0]}</b>${esc(x[1])}</li>`).join('');
  const price = sold ? (p.soldPriceText ? `成約価格 ${esc(p.soldPriceText)}` : '') : esc(p.priceText);
  return `<article class="cms-card${sold ? ' cms-sold' : ''}">
  ${href ? `<a class="cms-card-img" href="${href}">${img}</a>` : `<div class="cms-card-img">${img}</div>`}
  <div class="cms-card-body">
    <span class="cms-badge${STATUS_CLASS[p.status] || ''}">${esc(p.status)}</span>
    <h3>${href ? `<a href="${href}">${esc(p.name)}</a>` : esc(p.name)}</h3>
    ${price ? `<div class="cms-price">${price}</div>` : ''}
    <ul class="cms-specs">${specs}</ul>
    ${href ? `<a class="cms-btn" href="${href}">詳細を見る</a>` : ''}
  </div>
</article>`;
}

function sellListHtml(items) {
  const active = items.filter((p) => p.status !== '成約済');
  const sold = items.filter((p) => p.status === '成約済');
  let h = '';
  if (active.length) h += `<div class="cms-grid">${active.map(propCard).join('\n')}</div>`;
  else h += '<div class="cms-empty">現在公開中の物件はありません。随時更新します。</div>';
  if (sold.length) {
    h += `<h2 class="cms-h2">成約実績</h2><div class="cms-grid">${sold.map(propCard).join('\n')}</div>
<p class="cms-note">成約済の物件です。現在は販売しておりません。成約価格は、売主様・買主様の同意が得られたものだけ掲載しています。</p>`;
  }
  return h;
}

function propDetail(p) {
  const rows = [];
  const add = (k, v) => { if (v !== '' && v != null) rows.push([k, v]); };
  add('取引態様', p.dealType);
  add('所在地', p.address);
  add('交通', p.access);
  add('土地面積', p.landArea ? `${num(p.landArea)}㎡${p.landAreaKind ? `（${p.landAreaKind}）` : ''}` : '');
  add('建物面積', p.bldgArea ? `${num(p.bldgArea)}㎡` : '');
  add('築年月', p.built);
  add('間取り', p.layout);
  add('構造・階数', p.structure);
  add('土地権利', p.landRight);
  add('地目', p.landCategory);
  add('用途地域', p.zoning);
  add('建ぺい率・容積率', (p.bcr != null || p.far != null) ? `${p.bcr != null ? p.bcr + '%' : '－'} / ${p.far != null ? p.far + '%' : '－'}` : '');
  add('接道状況', p.road);
  add('私道負担', p.privateRoad);
  add('セットバック', p.setback);
  add('再建築', p.rebuild);
  add('駐車場', p.parking);
  add('現況', p.condition);
  add('引渡時期', p.delivery);
  add('設備', p.equipment);
  add('学区', p.school);
  add('ハザード情報', p.hazard);
  add('管理費等', p.fees);
  add('情報更新日', jpDate(p.updatedAt));
  const thumbs = p.photos.slice(1);
  const gallery = p.photos.length ? `<div class="cms-gallery">
  <img src="${esc(p.photos[0])}" alt="${esc(p.name)}" referrerpolicy="no-referrer">
  ${thumbs.length ? `<div class="thumbs">${thumbs.map((u, i) => `<img src="${esc(u)}" alt="${esc(p.name)} 写真${i + 2}" loading="lazy" referrerpolicy="no-referrer">`).join('')}</div>` : ''}
</div>` : '';
  const main = `<div class="cms-wrap">
  <p class="cms-crumb"><a href="/">トップ</a> ＞ <a href="/sell/">売物件一覧</a> ＞ ${esc(p.name)}</p>
  <span class="cms-badge${STATUS_CLASS[p.status] || ''}">${esc(p.status)}</span>
  <h1 style="font-size:24px;line-height:1.5;margin:8px 0">${esc(p.name)}</h1>
  <div class="cms-price" style="font-size:28px;margin-bottom:16px">${esc(p.priceText)}</div>
  ${gallery}
  ${p.description ? `<div class="cms-desc">${esc(p.description)}</div>` : ''}
  <dl class="cms-dl">${rows.map((r) => `<dt>${r[0]}</dt><dd>${esc(r[1])}</dd>`).join('')}</dl>
  <p class="cms-note">所在地は町名までを表示しています。詳細な所在地や現地のご案内は、お問い合わせください。現況が図面等と異なる場合は、現況を優先します。</p>
  <div class="cms-cta">
    <p style="margin-bottom:8px;font-weight:700">この物件についてのお問い合わせ（${esc(p.id)}）</p>
    <a href="/form/">お問い合わせフォーム</a>
    <a class="alt" href="tel:0727028043">072-702-8043</a>
  </div>
</div>`;
  const first = p.photos[0];
  return page({
    title: `${p.name}｜${p.priceText}｜${ORG}`,
    desc: `${p.address}の${p.type}。${p.priceText}。${p.access ? p.access + '。' : ''}${(p.description || '').replace(/\s+/g, ' ').slice(0, 60)}`,
    path: `/sell/${encodeURIComponent(p.id)}/`, image: first,
    ld: [crumbLd([['AGEnt-YeLL', '/'], ['売物件一覧', '/sell/'], [p.name, `/sell/${encodeURIComponent(p.id)}/`]])],
    main,
  });
}

// ---------- ブログ(カテゴリ大中小・エリアのまとめページつき) ----------
const catOf = (p) => p.catL || p.category || '';
function postCard(p) {
  const href = `/blog/${encodeURIComponent(p.id)}/`;
  const img = p.image ? `<img src="${esc(p.image)}" alt="${esc(p.title)}" loading="lazy" referrerpolicy="no-referrer">` : '<div class="cms-card-noimg">AGEnt-YeLL</div>';
  return `<article class="cms-card">
  <a class="cms-card-img" href="${href}">${img}</a>
  <div class="cms-card-body">
    <div class="cms-post-meta"><span class="cms-cat">${esc([catOf(p), p.catM].filter(Boolean).join(' / '))}</span><time datetime="${p.date}">${jpDate(p.date)}</time></div>
    <h3><a href="${href}">${esc(p.title)}</a></h3>
    <p class="cms-note" style="margin:0">${esc(p.summary)}</p>
    <a class="cms-btn" href="${href}">続きを読む</a>
  </div>
</article>`;
}

// カテゴリ(大)・エリアのリンク一覧
function blogNav(cats, areas, current) {
  const cl = cats.filter((c) => c.count > 0).map((c) => `<a class="cms-chip${current === 'c:' + c.slug ? ' on' : ''}" href="/blog/c/${esc(c.slug)}/">${esc(c.name)}<small>${c.count}</small></a>`).join('');
  const al = areas.filter((a) => a.count > 0).map((a) => `<a class="cms-chip${current === 'a:' + a.slug ? ' on' : ''}" href="/blog/area/${esc(a.slug)}/">${esc(a.city)}<small>${a.count}</small></a>`).join('');
  return `<nav class="cms-chips" aria-label="コラムの分類">
  <a class="cms-chip${!current ? ' on' : ''}" href="/blog/">すべて</a>${cl}
  ${al ? `<div class="cms-chips-row"><span class="cms-chips-label">エリア</span>${al}</div>` : ''}
</nav>`;
}

function blogListPage({ title, h1, lead, path: p, posts, cats, areas, current, crumb, noindex, mids }) {
  const groups = mids && mids.length ? mids.filter((m) => m.count > 0).map((m) => {
    const ps = posts.filter((x) => x.catM === m.name);
    return ps.length ? `<h2 class="cms-h2">${esc(m.name)}</h2><div class="cms-grid">${ps.map(postCard).join('\n')}</div>` : '';
  }).join('') + (() => { const rest = posts.filter((x) => !mids.some((m) => m.name === x.catM)); return rest.length ? `<div class="cms-grid">${rest.map(postCard).join('\n')}</div>` : ''; })()
    : `<div class="cms-grid">${posts.map(postCard).join('\n')}</div>`;
  const main = `<div class="cms-wrap">
  <p class="cms-crumb"><a href="/">トップ</a> ＞ ${crumb}</p>
  <h1 style="font-size:26px;margin:8px 0 6px">${esc(h1)}</h1>
  <p class="cms-note">${esc(lead)}</p>
  ${blogNav(cats, areas, current)}
  ${posts.length ? groups : '<div class="cms-empty">コラムは準備中です。</div>'}
</div>`;
  return page({ title: `${title}｜${ORG}`, desc: lead, path: p, main, noindex: noindex || !posts.length,
    ld: [crumbLd([['AGEnt-YeLL', '/'], ['コラム', '/blog/']].concat(p === '/blog/' ? [] : [[h1, p]]))] });
}

function blogIndex(posts, cats, areas) {
  return blogListPage({ title: '不動産コラム', h1: '不動産コラム',
    lead: '川西市を中心に、不動産の売却・購入・空き家・相続について、宅建士が解説します。', path: '/blog/', posts, cats, areas, current: '',
    crumb: 'コラム', noindex: !posts.length });
}

// 関連記事: 同じ中分類 → 同じ大分類 → 同じエリア の順
function relatedPosts(p, posts) {
  const score = (x) => (p.catM && x.catM === p.catM ? 4 : 0) + (catOf(p) && catOf(x) === catOf(p) ? 2 : 0) + (p.areaCity && x.areaCity === p.areaCity ? 1 : 0)
    + (p.tags || []).filter((t) => (x.tags || []).includes(t)).length * 0.5;
  return posts.filter((x) => x.id !== p.id && score(x) > 0).sort((a, b) => score(b) - score(a) || (a.date < b.date ? 1 : -1)).slice(0, 4);
}

function blogPost(p, posts, cats) {
  const url = `/blog/${encodeURIComponent(p.id)}/`;
  const catLink = catOf(p) ? (() => { const c = cats.find((x) => x.name === catOf(p)); return c && c.count > 0 ? `<a href="/blog/c/${esc(c.slug)}/">${esc(catOf(p))}</a>` : esc(catOf(p)); })() : '';
  const rel = relatedPosts(p, posts);
  const main = `<article class="cms-article">
  <p class="cms-crumb"><a href="/">トップ</a> ＞ <a href="/blog/">コラム</a>${catLink ? ` ＞ ${catLink}` : ''} ＞ ${esc(p.title)}</p>
  <div class="cms-post-meta"><span class="cms-cat">${esc([catOf(p), p.catM, p.catS].filter(Boolean).join(' / '))}</span>
    <time datetime="${p.date}">${jpDate(p.date)}</time>
    ${p.updatedAt && p.updatedAt !== p.date ? `<span>更新 <time datetime="${p.updatedAt}">${jpDate(p.updatedAt)}</time></span>` : ''}
    ${p.author ? `<span>執筆：${esc(p.author)}</span>` : ''}</div>
  <h1>${esc(p.title)}</h1>
  ${p.image ? `<img class="cms-eyecatch" src="${esc(p.image)}" alt="${esc(p.title)}" referrerpolicy="no-referrer">` : ''}
  ${p.bodyHtml}
  ${(p.tags || []).length ? `<div class="cms-tags">${p.tags.map((t) => `<span>#${esc(t)}</span>`).join('')}</div>` : ''}
  <div class="cms-cta">
    <p style="margin-bottom:8px;font-weight:700">不動産のご相談は、お気軽に</p>
    <a href="/form/">無料でAI査定</a>
    <a class="alt" href="tel:0727028043">072-702-8043</a>
  </div>
  ${rel.length ? `<h2 class="cms-h2">あわせて読みたい</h2><div class="cms-grid">${rel.map(postCard).join('\n')}</div>` : ''}
</article>`;
  const crumbs = [['AGEnt-YeLL', '/'], ['コラム', '/blog/']];
  const c = cats.find((x) => x.name === catOf(p));
  if (c && c.count > 0) crumbs.push([c.name, `/blog/c/${c.slug}/`]);
  crumbs.push([p.title, url]);
  const ld = [
    crumbLd(crumbs),
    { '@context': 'https://schema.org', '@type': 'Article', headline: p.title, description: p.seoDescription,
      datePublished: p.date, dateModified: p.updatedAt || p.date, mainEntityOfPage: SITE + url,
      ...(p.image ? { image: [p.image] } : {}), ...(catOf(p) ? { articleSection: catOf(p) } : {}), ...((p.tags || []).length ? { keywords: p.tags.join(',') } : {}),
      author: p.author ? { '@type': 'Person', name: p.author } : { '@type': 'Organization', name: ORG },
      publisher: { '@type': 'Organization', name: ORG, logo: { '@type': 'ImageObject', url: SITE + '/assets/apple-touch-icon.png' } } },
  ];
  // よくある質問(Q&A)があれば、検索結果用の構造化データも付ける
  const faq = [...String(p.bodyHtml).matchAll(/<div class="cms-faq"><p class="q">([\s\S]*?)<\/p><p class="a">([\s\S]*?)<\/p><\/div>/g)]
    .map((m) => ({ '@type': 'Question', name: m[1].replace(/<[^>]+>/g, '').replace(/^Q\.\s*/, ''), acceptedAnswer: { '@type': 'Answer', text: m[2].replace(/<[^>]+>/g, '') } }));
  if (faq.length) ld.push({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq });
  return page({ title: `${p.title}｜${ORG}`, desc: p.seoDescription, path: url, image: p.image, ld, main, type: 'article' });
}

// ---------- 口コミ ----------
const stars = (n) => n >= 1 && n <= 5 ? '★'.repeat(n) + '☆'.repeat(5 - n) : '';
function reviewHtml(r) {
  return `<article class="vc rv">
  ${r.kind ? `<span class="vc-kind">${esc(r.kind)}</span>` : ''}
  ${stars(r.rating) ? `<div class="vc-stars" aria-hidden="true">${stars(r.rating)}</div>` : ''}
  <p class="vc-text">${esc(r.text).replace(/\n/g, '<br>')}</p>
  <div class="vc-meta"><div class="vc-who">${esc(r.label)}${r.date ? `<span>${jpDate(r.date)} 投稿</span>` : ''}</div></div>
  ${r.reply ? `<div class="vc-reply"><b>AGEnt-YeLLより：</b>${esc(r.reply).replace(/\n/g, '<br>')}</div>` : ''}
</article>`;
}

// ---------- sitemap ----------
function updateSitemap(props, posts, cats, areas) {
  const f = 'sitemap.xml';
  let x = rd(f);
  x = x.replace(/\s*<!-- cms:start -->[\s\S]*?<!-- cms:end -->/, '');
  const today = new Date().toISOString().slice(0, 10);
  const urls = (posts.length ? [`<url><loc>${SITE}/blog/</loc><lastmod>${today}</lastmod><priority>0.7</priority></url>`] : [])
    .concat((cats || []).filter((c) => c.count > 0).map((c) => `<url><loc>${SITE}/blog/c/${c.slug}/</loc><lastmod>${today}</lastmod><priority>0.5</priority></url>`))
    .concat((areas || []).filter((a) => a.count > 0).map((a) => `<url><loc>${SITE}/blog/area/${a.slug}/</loc><lastmod>${today}</lastmod><priority>0.5</priority></url>`))
    .concat(posts.map((p) => `<url><loc>${SITE}/blog/${encodeURIComponent(p.id)}/</loc><lastmod>${p.updatedAt || p.date}</lastmod><priority>0.6</priority></url>`))
    .concat(props.filter((p) => p.status !== '成約済').map((p) => `<url><loc>${SITE}/sell/${encodeURIComponent(p.id)}/</loc><lastmod>${p.updatedAt || today}</lastmod><priority>0.6</priority></url>`));
  x = x.replace('</urlset>', `  <!-- cms:start -->\n  ${urls.join('\n  ')}\n  <!-- cms:end -->\n</urlset>`);
  wr(f, x);
}

// ---------- 実行 ----------
(async () => {
  prepareOut();
  loadTemplate();
  const log = [];
  let props = null, posts = null, reviews = null, cats = [], areas = [];
  try { props = (await getJson('properties')).items.filter(safeId); } catch (e) { log.push('物件の取得に失敗(今のページを使用): ' + e.message); }
  try { posts = (await getJson('posts', '&full=1')).items.filter(safeId); } catch (e) { log.push('ブログの取得に失敗(今のページを使用): ' + e.message); }
  try { cats = (await getJson('categories')).items.filter((c) => /^[A-Za-z0-9-]+$/.test(c.slug)); } catch (e) { log.push('カテゴリの取得に失敗(分類ページなし): ' + e.message); }
  try { areas = (await getJson('areas')).items.filter((a) => /^[A-Za-z0-9-]+$/.test(a.slug)); } catch (e) { log.push('エリアの取得に失敗(エリアページなし): ' + e.message); }
  try { reviews = (await getJson('reviews')).items; } catch (e) { log.push('口コミの取得に失敗(今のページを使用): ' + e.message); }

  if (props) {
    wr('sell/index.html', inject(rd('sell/index.html'), 'PROPERTIES', sellListHtml(props)));
    props.filter((p) => p.status !== '成約済').forEach((p) => wr(`sell/${p.id}/index.html`, propDetail(p)));
    log.push(`物件 ${props.length}件`);
  }
  if (posts) {
    // カテゴリ・エリアの記事数は、公開中の記事から数え直す(APIの数と食い違わないように)
    cats.forEach((c) => { c.count = posts.filter((p) => catOf(p) === c.name).length; });
    areas.forEach((a) => { a.count = posts.filter((p) => p.areaCity === a.city).length; });
    wr('blog/index.html', blogIndex(posts, cats, areas));
    cats.filter((c) => c.count > 0).forEach((c) => wr(`blog/c/${c.slug}/index.html`, blogListPage({
      title: `${c.name}のコラム`, h1: `${c.name}のコラム`, lead: `${c.name}に関する不動産コラムの一覧です。`, path: `/blog/c/${c.slug}/`,
      posts: posts.filter((p) => catOf(p) === c.name), cats, areas, current: 'c:' + c.slug, crumb: `<a href="/blog/">コラム</a> ＞ ${esc(c.name)}`, mids: c.mids })));
    areas.filter((a) => a.count > 0).forEach((a) => wr(`blog/area/${a.slug}/index.html`, blogListPage({
      title: `${a.city}の不動産コラム`, h1: `${a.city}の不動産コラム`, lead: `${a.city}の不動産(売却・購入・空き家・相続・暮らし)に関するコラムの一覧です。`, path: `/blog/area/${a.slug}/`,
      posts: posts.filter((p) => p.areaCity === a.city), cats, areas, current: 'a:' + a.slug, crumb: `<a href="/blog/">コラム</a> ＞ ${esc(a.city)}` })));
    posts.forEach((p) => wr(`blog/${p.id}/index.html`, blogPost(p, posts, cats)));
    log.push(`ブログ ${posts.length}件`);
  }
  if (reviews) {
    wr('voice/index.html', inject(rd('voice/index.html'), 'REVIEWS', reviews.map(reviewHtml).join('\n')));
    log.push(`口コミ ${reviews.length}件`);
  }
  if (props || posts) updateSitemap(props || [], posts || [], cats, areas);
  console.log('[build-cms] ' + (log.join(' / ') || '変更なし') + '  → ' + path.relative(process.cwd(), OUT || '.'));
})().catch((e) => { console.error('[build-cms] エラー(サイトの公開は続行):', e); process.exit(0); });
