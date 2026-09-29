/* Loads /api/posts and fills: top ticker, the three boxes, and the details popup. */
(() => {
  'use strict';

  const WA_NUMBER = '917800504223';
  const PAGE = 6; // rows shown per box before "और देखें"
  const ORDER = ['job', 'admit', 'result'];
  const CATS = {
    job:    { label: 'नई भर्ती',    icon: 'fa-briefcase',            dateLabel: 'अंतिम तिथि',   cta: 'इस भर्ती का फॉर्म भरवाना है?',              ask: 'का फॉर्म भरवाना है' },
    admit:  { label: 'एडमिट कार्ड', icon: 'fa-id-badge',             dateLabel: 'परीक्षा तिथि', cta: 'एडमिट कार्ड निकलवाना और प्रिंट करवाना है?', ask: 'का एडमिट कार्ड निकलवाना है' },
    result: { label: 'रिज़ल्ट',      icon: 'fa-square-poll-vertical', dateLabel: 'रिज़ल्ट तिथि', cta: 'रिज़ल्ट या मार्कशीट का प्रिंट चाहिए?',       ask: 'का रिज़ल्ट निकलवाना है' },
  };
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : '#'; } catch (_) { return '#'; } };

  const state = { posts: [], q: '', open: {}, failed: false };
  let tickerHTML = '';

  /* ---------- dates ---------- */
  function parseISO(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  const fmtDate = (d) => `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`;
  function daysLeft(d) {
    const t = new Date(); t.setHours(0, 0, 0, 0);
    return Math.round((d - t) / 864e5);
  }
  function dateInfo(p) {
    const d = parseISO(p.keyDate);
    if (!d) return null;
    const label = p.keyDateLabel || CATS[p.category].dateLabel;
    let cls = '', extra = '';
    if (p.category === 'job') {
      const n = daysLeft(d);
      if (n < 0) { cls = 'is-over'; extra = ' (समाप्त)'; }
      else if (n === 0) { cls = 'is-soon'; extra = ' (आज आख़िरी दिन)'; }
      else if (n <= 3) { cls = 'is-soon'; extra = ` (${n} दिन बाकी)`; }
    }
    return { text: `${label}: ${fmtDate(d)}${extra}`, short: `${label} ${fmtDate(d)}`, cls };
  }
  const isNew = (p) => Date.now() - Date.parse(p.createdAt) < 3 * 864e5;

  /* ---------- ticker ---------- */
  function tickerItem(p, hidden) {
    const c = CATS[p.category];
    const di = dateInfo(p);
    return `<button type="button" class="tk-item" data-post="${esc(p.id)}"${hidden ? ' tabindex="-1"' : ''}>` +
      `<span class="tk-chip ${p.category}">${c.label}</span>` +
      `<span class="tk-text">${esc(p.title)}</span>` +
      (di ? `<span class="tk-date">${esc(di.short)}</span>` : '') +
      '</button>';
  }

  function renderTicker() {
    const bar = $('#tkBar');
    const track = $('#tkTrack');
    if (!bar || !track) return;
    const items = state.posts.filter((p) => p.ticker !== false).slice(0, 20);
    if (!items.length) { bar.hidden = true; return; }
    tickerHTML = items.map((p) => tickerItem(p, false)).join('');
    track.innerHTML = '<div class="tk-set"></div><div class="tk-set" aria-hidden="true"></div>';
    bar.hidden = false;
    fitTicker(items);
  }

  function fitTicker(items) {
    const track = $('#tkTrack');
    const sets = track && track.querySelectorAll('.tk-set');
    if (!sets || sets.length < 2) return;
    items = items || state.posts.filter((p) => p.ticker !== false).slice(0, 20);
    const hiddenHTML = items.map((p) => tickerItem(p, true)).join('');
    sets[0].innerHTML = tickerHTML;
    const one = sets[0].offsetWidth || 1;
    const viewport = $('#tkBar .tk-viewport').clientWidth || window.innerWidth;
    const k = Math.max(1, Math.ceil(viewport / one)); // repeat so each half is at least as wide as the screen
    sets[0].innerHTML = tickerHTML.repeat(k);
    sets[1].innerHTML = hiddenHTML.repeat(k);
    track.style.setProperty('--tk-dur', `${Math.max(20, Math.round((one * k) / 60))}s`);
  }

  /* ---------- boxes ---------- */
  function rowHTML(p) {
    const di = dateInfo(p);
    const bits = [];
    if (isNew(p)) bits.push('<span class="upd-new">NEW</span>');
    if (p.org) bits.push(`<span>${esc(p.org)}</span>`);
    if (di) bits.push(`<span class="upd-date ${di.cls}">${esc(di.text)}</span>`);
    return `<li><button type="button" class="upd-row" data-post="${esc(p.id)}">` +
      `<span class="upd-title">${esc(p.title)}</span>` +
      (bits.length ? `<span class="upd-meta">${bits.join('')}</span>` : '') +
      '</button></li>';
  }

  function renderBoxes() {
    const grid = $('#updGrid');
    if (!grid) return;
    if (state.failed) {
      grid.innerHTML = '<p class="upd-note">अपडेट अभी लोड नहीं हो पाए। थोड़ी देर बाद पेज रीफ़्रेश करें।</p>';
      return;
    }
    const q = state.q.trim().toLowerCase();
    grid.innerHTML = ORDER.map((cat) => {
      const c = CATS[cat];
      const all = state.posts.filter((p) => p.category === cat);
      const list = q ? all.filter((p) => `${p.title} ${p.org || ''}`.toLowerCase().includes(q)) : all;
      const open = !!state.open[cat];
      const shown = open ? list : list.slice(0, PAGE);
      let body;
      if (!list.length) {
        body = `<p class="upd-empty">${q ? 'इस खोज से कोई पोस्ट नहीं मिली।' : 'अभी कोई पोस्ट नहीं है। जल्द ही नई जानकारी यहाँ आएगी।'}</p>`;
      } else {
        body = `<ul class="upd-list">${shown.map(rowHTML).join('')}</ul>`;
      }
      const more = list.length > PAGE
        ? `<div class="upd-foot"><button type="button" class="upd-more" data-more="${cat}" aria-expanded="${open}">${open ? 'कम दिखाएँ' : `और देखें (${list.length - PAGE})`}</button></div>`
        : '';
      return `<section class="upd-box ${cat}" aria-labelledby="upd-h-${cat}">` +
        `<header class="upd-head"><span class="upd-ic" aria-hidden="true"><i class="fa-solid ${c.icon}"></i></span>` +
        `<h3 id="upd-h-${cat}">${c.label}</h3><span class="upd-count" aria-label="${list.length} पोस्ट">${list.length}</span></header>` +
        body + more + '</section>';
    }).join('');

    const stamp = $('#updStamp');
    if (stamp) {
      const last = state.posts.reduce((m, p) => Math.max(m, Date.parse(p.updatedAt || p.createdAt) || 0), 0);
      stamp.textContent = last ? `आख़िरी अपडेट: ${fmtDate(new Date(last))}` : '';
    }
  }

  /* ---------- popup ---------- */
  const dlg = $('#updDialog');
  const isPrimaryLink = (label) => /apply|admit|result|login|check|आवेदन/i.test(label);

  function dialogHTML(p) {
    const c = CATS[p.category];
    const di = dateInfo(p);

    const groups = [];
    const byGroup = new Map();
    (p.details || []).forEach((d) => {
      const g = d.group || '';
      if (!byGroup.has(g)) { byGroup.set(g, []); groups.push(g); }
      byGroup.get(g).push(d);
    });
    const detailsHTML = groups.map((g) =>
      `<section class="dlg-sec">${g ? `<h4>${esc(g)}</h4>` : ''}<dl>` +
      byGroup.get(g).map((d) => `<div><dt>${esc(d.label)}</dt><dd>${esc(d.value)}</dd></div>`).join('') +
      '</dl></section>').join('');

    const linksHTML = (p.links || []).length
      ? '<section class="dlg-sec"><h4>ज़रूरी लिंक</h4><div class="dlg-links">' +
        p.links.map((l) => `<a class="${isPrimaryLink(l.label) ? 'is-primary' : ''}" href="${esc(safeUrl(l.url))}" target="_blank" rel="noopener noreferrer nofollow">${esc(l.label)} <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i></a>`).join('') +
        '</div></section>'
      : '';

    const pageUrl = `${location.origin}${location.pathname}#post-${p.id}`;
    const wa = `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(`Hello Vivek Computer, mujhe "${p.title}" ${c.ask}.`)}`;
    const share = `https://wa.me/?text=${encodeURIComponent(`${p.title}\n${pageUrl}`)}`;
    const source = p.showSource && p.source
      ? ` जानकारी का स्रोत: <a href="${esc(safeUrl(p.source))}" target="_blank" rel="noopener noreferrer nofollow" class="underline">देखें</a>.`
      : '';

    return `<div class="dlg-body">` +
      `<div class="dlg-head">` +
        `<span class="dlg-kind"><i class="fa-solid ${c.icon}" aria-hidden="true"></i>${c.label}</span>` +
        `<button type="button" class="dlg-x" data-close aria-label="बंद करें"><span aria-hidden="true">✕</span></button>` +
        `<h3 id="updDlgTitle">${esc(p.title)}</h3>` +
        `<p class="dlg-sub">${p.org ? `<span>${esc(p.org)}</span>` : ''}${di ? `<span class="${di.cls}">${esc(di.text)}</span>` : ''}</p>` +
      `</div>` +
      `<div class="dlg-content">` +
        (p.note ? `<p class="dlg-note">${esc(p.note)}</p>` : '') +
        (detailsHTML || (linksHTML ? '' : '<p class="dlg-note">पूरी जानकारी के लिए दुकान पर संपर्क करें।</p>')) +
        linksHTML +
        `<div class="dlg-cta"><div><b>${c.cta}</b><span>Vivek Computer, Ratsar Kalan — दुकान पर आइए या WhatsApp करें।</span></div>` +
          `<div class="dlg-cta-btns">` +
            `<a class="dlg-btn wa" href="${esc(wa)}" target="_blank" rel="noopener"><i class="fa-brands fa-whatsapp" aria-hidden="true"></i>WhatsApp करें</a>` +
            `<a class="dlg-btn sh" href="${esc(share)}" target="_blank" rel="noopener"><i class="fa-solid fa-share-nodes" aria-hidden="true"></i>शेयर करें</a>` +
          `</div></div>` +
        `<p class="dlg-foot">आवेदन या डाउनलोड से पहले official notification ज़रूर जाँच लें।${source}</p>` +
      `</div></div>`;
  }

  function openPost(id) {
    const p = state.posts.find((x) => x.id === id);
    if (!p || !dlg) return;
    dlg.className = `upd-dialog ${p.category}`;
    dlg.innerHTML = dialogHTML(p);
    if (!dlg.open) {
      if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    }
    document.documentElement.style.overflow = 'hidden';
    history.replaceState(null, '', `#post-${id}`);
  }

  function closeDialog() {
    if (typeof dlg.close === 'function') dlg.close(); else dlg.removeAttribute('open');
    onClosed();
  }
  function onClosed() {
    document.documentElement.style.overflow = '';
    if (location.hash.startsWith('#post-')) history.replaceState(null, '', location.pathname + location.search);
  }

  if (dlg) {
    dlg.addEventListener('close', onClosed);
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg || e.target.closest('[data-close]')) closeDialog();
    });
  }

  /* ---------- events ---------- */
  document.addEventListener('click', (e) => {
    const post = e.target.closest('[data-post]');
    if (post) { openPost(post.dataset.post); return; }
    const more = e.target.closest('[data-more]');
    if (more) {
      const cat = more.dataset.more;
      state.open[cat] = !state.open[cat];
      renderBoxes();
      const again = document.querySelector(`[data-more="${cat}"]`);
      if (again) again.focus();
    }
  });

  const search = $('#updSearch');
  if (search) search.addEventListener('input', () => { state.q = search.value; renderBoxes(); });

  const pause = $('#tkPause');
  if (pause) {
    pause.addEventListener('click', () => {
      const paused = $('#tkBar').classList.toggle('is-paused');
      pause.setAttribute('aria-pressed', String(paused));
      pause.setAttribute('aria-label', paused ? 'टिकर चलाएँ' : 'टिकर रोकें');
      pause.innerHTML = `<i class="fa-solid ${paused ? 'fa-play' : 'fa-pause'}" aria-hidden="true"></i>`;
    });
  }

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (!$('#tkBar').hidden) fitTicker(); }, 200);
  });

  function openFromHash() {
    const m = /^#post-([a-f0-9]+)$/.exec(location.hash);
    if (m) openPost(m[1]);
  }
  window.addEventListener('hashchange', openFromHash);

  /* ---------- load ---------- */
  fetch('/api/posts', { cache: 'no-cache' })
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then((list) => {
      state.posts = Array.isArray(list) ? list.filter((p) => p && CATS[p.category] && p.title) : [];
      renderTicker();
      renderBoxes();
      openFromHash();
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (!$('#tkBar').hidden) fitTicker(); });
    })
    .catch(() => {
      state.failed = true;
      renderBoxes();
    });
})();
