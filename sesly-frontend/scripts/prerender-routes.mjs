// Runs after `vite build`. The site is a client-rendered SPA, so every route
// used to get the same index.html (Home title, no canonical). Crawlers that do
// not run JavaScript, link previews and Search Console's first pass saw one page
// under many URLs ("Duplicate without user-selected canonical"). This writes one
// HTML file per public route with its own title, description, Open Graph tags
// and canonical URL (Turkish, the default locale), plus 404.html, which nginx
// serves with a real 404 status for unknown paths. react-helmet-async still
// takes over in the browser.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const BASE = 'https://sesly.io';
const seo = JSON.parse(readFileSync(path.join(root, 'src/i18n/tr/common.json'), 'utf8')).seo;

const ROUTES = [
  { file: 'index.html', path: '/', key: 'home' },
  { file: 'privacy.html', path: '/privacy', key: 'privacy' },
  { file: 'terms.html', path: '/terms', key: 'tos' },
  { file: 'data-deletion.html', path: '/data-deletion', key: 'dataDeletion' },
];

const template = readFileSync(path.join(dist, 'index.html'), 'utf8');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function replaceOnce(html, re, value, label) {
  if (!re.test(html)) throw new Error(`prerender: ${label} not found in dist/index.html`);
  return html.replace(re, value);
}

function render({ title, description, url, noIndex }) {
  let html = template;
  html = replaceOnce(html, /<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`, 'title');
  html = replaceOnce(html, /<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(description)}">`, 'description');
  html = replaceOnce(html, /<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${esc(title)}">`, 'og:title');
  html = replaceOnce(html, /<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${esc(description)}">`, 'og:description');
  html = replaceOnce(html, /<meta name="twitter:title" content="[^"]*">/, `<meta name="twitter:title" content="${esc(title)}">`, 'twitter:title');
  html = replaceOnce(html, /<meta name="twitter:description" content="[^"]*">/, `<meta name="twitter:description" content="${esc(description)}">`, 'twitter:description');
  if (url) {
    html = replaceOnce(html, /<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${url}">`, 'og:url');
    html = replaceOnce(html, /<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${url}">`, 'canonical');
  } else {
    html = html.replace(/\s*<meta property="og:url" content="[^"]*">/, '').replace(/\s*<link rel="canonical" href="[^"]*">/, '');
  }
  if (noIndex) html = html.replace('</head>', '    <meta name="robots" content="noindex">\n  </head>');
  return html;
}

for (const r of ROUTES) {
  const { title, description } = seo[r.key];
  writeFileSync(path.join(dist, r.file), render({ title, description, url: `${BASE}${r.path === '/' ? '/' : r.path}` }));
  console.log(`prerender: ${r.file} -> ${r.path}`);
}
writeFileSync(
  path.join(dist, '404.html'),
  render({ title: 'Sayfa bulunamadı - Sesly', description: seo.home.description, url: null, noIndex: true }),
);
console.log('prerender: 404.html');
