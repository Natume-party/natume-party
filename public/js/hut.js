// 小屋里的内容：关于我 / 作品 / 日记。内容放在 /content 下的 Markdown 文件里。
// 地址栏路由：#/about、#/works、#/diary、#/diary/<slug>，可以直接分享某一篇。

import { renderGuestbook } from './guestbook.js';

const TABS = { about: '关于我', works: '作品', notes: '工作手记', diary: '日记', guestbook: '留言' };

const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = (u) => (/^(https?:|mailto:|\/|#|\.\/)/i.test(u) ? u : '#');

function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) => `<img alt="${alt}" src="${safeUrl(src)}" loading="lazy">`)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, href) => {
      const url = safeUrl(href);
      const ext = /^https?:/i.test(url) ? ' target="_blank" rel="noopener"' : '';
      return `<a href="${url}"${ext}>${text}</a>`;
    })
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

// 够用的小型 Markdown：标题、段落、列表、引用、分隔线、代码块、粗斜体、链接、图片
export function markdown(src) {
  const lines = src.replace(/\r/g, '').split('\n');
  const out = [];
  let para = [], list = null, quote = [], code = null;
  const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`); list = null; } };
  const flushQuote = () => { if (quote.length) { out.push(`<blockquote>${inline(quote.join(' '))}</blockquote>`); quote = []; } };
  const flushAll = () => { flushPara(); flushList(); flushQuote(); };
  for (const line of lines) {
    if (code !== null) {
      if (/^```/.test(line)) { out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`); code = null; } else code.push(line);
      continue;
    }
    let m;
    if (/^```/.test(line)) { flushAll(); code = []; }
    else if ((m = line.match(/^(#{1,3})\s+(.*)$/))) { flushAll(); const n = m[1].length + 1; out.push(`<h${n}>${inline(m[2])}</h${n}>`); }
    else if (/^(-{3,}|\*{3,})\s*$/.test(line)) { flushAll(); out.push('<hr>'); }
    else if ((m = line.match(/^\s*[-*]\s+(.*)$/))) { flushPara(); flushQuote(); if (!list || list.tag !== 'ul') { flushList(); list = { tag: 'ul', items: [] }; } list.items.push(m[1]); }
    else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) { flushPara(); flushQuote(); if (!list || list.tag !== 'ol') { flushList(); list = { tag: 'ol', items: [] }; } list.items.push(m[1]); }
    else if ((m = line.match(/^>\s?(.*)$/))) { flushPara(); flushList(); quote.push(m[1]); }
    else if (!line.trim()) flushAll();
    else { flushList(); flushQuote(); para.push(line.trim()); }
  }
  if (code !== null) out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
  flushAll();
  return out.join('\n');
}

const cache = new Map();
async function load(path) {
  if (!cache.has(path)) {
    cache.set(path, fetch(path, { cache: 'no-cache' }).then((r) => {
      if (!r.ok) throw new Error(`${r.status}`);
      return path.endsWith('.json') ? r.json() : r.text();
    }).catch((e) => { cache.delete(path); throw e; }));
  }
  return cache.get(path);
}

export function initHut({ onClose } = {}) {
  const dialog = document.getElementById('card');
  const content = document.getElementById('card-content');
  const tabs = [...dialog.querySelectorAll('[data-tab]')];
  let current = null;
  let token = 0;

  function parse(hash) {
    const m = (hash || '').match(/^#\/(about|works|notes|diary|guestbook)(?:\/([\w-]+))?$/);
    return m ? { tab: m[1], slug: m[2] || null } : null;
  }

  async function render(route) {
    const my = ++token;
    dialog.dataset.tab = route.tab;
    tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === route.tab)));
    content.setAttribute('aria-busy', 'true');
    if (route.tab === 'guestbook') {
      content.removeAttribute('aria-busy');
      await renderGuestbook(content);
      return;
    }
    let html;
    try {
      if (route.tab === 'diary' || route.tab === 'notes') {
        const folder = route.tab;
        const sectionName = folder === 'notes' ? '工作手记' : '日记';
        const list = await load(`/content/${folder}/index.json`);
        const posts = [...list].sort((a, b) => (a.date < b.date ? 1 : -1));
        if (route.slug) {
          const post = posts.find((p) => p.slug === route.slug);
          if (!post) throw new Error('404');
          const md = await load(`/content/${folder}/${post.slug}.md`);
          html = `<p class="back"><a href="#/${folder}">← 全部${sectionName}</a></p><p class="date">${esc(post.date)}</p>${markdown(md)}`;
        } else {
          html = posts.length
            ? `<ul class="posts">${posts.map((p) => `<li><a href="#/${folder}/${esc(p.slug)}"><span class="date">${esc(p.date)}</span><span class="title">${esc(p.title)}</span></a></li>`).join('')}</ul>`
            : `<p>还没有${sectionName}。</p>`;
        }
      } else {
        html = markdown(await load(`/content/${route.tab}.md`));
      }
    } catch {
      html = '<p>这一页暂时打不开，稍后再试试。</p>';
    }
    if (my !== token) return;
    content.innerHTML = html;
    content.removeAttribute('aria-busy');
    content.scrollTop = 0;
  }

  function show(route) {
    current = route;
    if (!dialog.open) dialog.showModal();
    document.body.classList.add('has-dialog');
    render(route);
  }

  function open(tab = 'about', slug = null) {
    const hash = `#/${tab}${slug ? `/${slug}` : ''}`;
    if (location.hash !== hash) history.pushState(null, '', hash);
    show({ tab, slug });
  }

  tabs.forEach((t) => t.addEventListener('click', () => open(t.dataset.tab)));
  dialog.addEventListener('close', () => {
    if (dialog.open) return; // 关闭事件晚到时对话框可能已被重新打开
    current = null;
    document.body.classList.remove('has-dialog');
    if (parse(location.hash)) history.replaceState(null, '', location.pathname + location.search);
    onClose?.();
  });
  addEventListener('hashchange', () => {
    const r = parse(location.hash);
    if (r) show(r);
    else if (dialog.open) dialog.close();
  });
  // 点对话框外面的遮罩也能关闭
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

  async function latestDiary() {
    try {
      const list = await load('/content/diary/index.json');
      return [...list].sort((a, b) => (a.date < b.date ? 1 : -1))[0] || null;
    } catch { return null; }
  }

  return { open, latestDiary, initial: parse(location.hash), get current() { return current; }, labels: TABS };
}
