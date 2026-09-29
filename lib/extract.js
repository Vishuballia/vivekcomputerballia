'use strict';
/*
  Takes the HTML of a job / admit card / result page (e.g. a SarkariResult post)
  and pulls out the important facts: title, dates, fees, vacancies, links.

  It is heuristic: it reads tables and "Label : Value" lines. Whatever it finds
  is only a DRAFT - the admin always reviews and edits before publishing.
*/
const cheerio = require('cheerio');

const clean = (s) => String(s == null ? '' : s).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

/* ---------- dates ---------- */
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function iso(y, m, d) {
  y = +y; m = +m; d = +d;
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return '';
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return '';
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function parseDate(text) {
  const t = clean(text);
  let m = t.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})\b/); // dd/mm/yyyy (Indian order)
  if (m) return iso(m[3], m[2], m[1]);
  m = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?[\s,\-]+([A-Za-z]{3,9})[\s,\-]+(\d{4})\b/); // 15 Oct 2026
  if (m && MONTHS[m[2].slice(0, 3).toLowerCase()]) return iso(m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], m[1]);
  m = t.match(/\b([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/); // October 15, 2026
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()]) return iso(m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], m[2]);
  return '';
}

/* ---------- category / title ---------- */
function guessCategory(title) {
  const t = String(title || '');
  if (/admit\s*card|hall\s*ticket|call\s*letter|प्रवेश\s*पत्र|एडमिट/i.test(t)) return 'admit';
  if (/result|merit\s*list|answer\s*key|score\s*card|cut\s*off|रिज़ल्ट|रिजल्ट|परिणाम/i.test(t)) return 'result';
  return 'job';
}

function cleanTitle(t) {
  return clean(t)
    .replace(/\s*[|@–—-]\s*(sarkari\s*result|sarkariresult|www\.)[^]*$/i, '')
    .replace(/\s*@\s*\S+$/i, '')
    .trim();
}

function pickTitle($) {
  const candidates = [
    $('h1').first().text(),
    $('meta[property="og:title"]').attr('content'),
    $('title').first().text(),
  ].map(cleanTitle);
  return candidates.find((t) => t.length >= 8 && !/^sarkari\s*result/i.test(t)) || candidates.find(Boolean) || '';
}

/* ---------- helpers ---------- */
const SOCIAL = /(t\.me|telegram|whatsapp|wa\.me|facebook|instagram|youtube|youtu\.be|twitter|x\.com|play\.google|linkedin)/i;
const GENERIC_ANCHOR = /^(click here|click|here|link|download|download link|apply|open|view|visit|click to apply|link \d+|https?:\/\/\S*|www\.\S*|यहाँ|यहां|यहाँ क्लिक करें|यहां क्लिक करें|क्लिक करें)$/i;
const KEY_LINK = /notification|notice|advertis|apply|admit|hall\s*ticket|result|answer\s*key|syllabus|download|official|website|login|registration|vacancy|pdf|अधिसूचना|आवेदन/i;
const JUNK_LABEL = /^(join|follow|share|telegram|whatsapp|subscribe|advertis|copyright|short information)/i;

function absUrl(href, base) {
  try {
    const u = new URL(href, base);
    return /^https?:$/.test(u.protocol) ? u.href : '';
  } catch (_) {
    return '';
  }
}

function lines($, cell) {
  const c = $(cell).clone();
  c.find('br').replaceWith('\n');
  c.find('li,p,div,h1,h2,h3,h4,h5,h6,tr').each((_, e) => { $(e).append('\n'); });
  return c.text().split(/\n+/).map(clean).filter(Boolean);
}

function kv(line) {
  const m = line.match(/^(.{2,80}?)\s*[:：]\s*(.{1,400})$/);
  if (!m) return null;
  const label = m[1].trim();
  const value = m[2].trim();
  if (!/[A-Za-z\u0900-\u097F]{2}/.test(label)) return null; // skips "10:30 AM"
  if (/^https?$/i.test(label)) return null;                    // skips "https://..."
  return { label, value };
}

/* ---------- main ---------- */
function extractPage(html, pageUrl) {
  const $ = cheerio.load(html);
  $('script,style,noscript,template,svg').remove();
  const base = new URL(pageUrl);
  const baseHost = base.hostname.replace(/^www\./, '');

  const title = pickTitle($);
  const category = guessCategory(title);

  const details = [];
  const links = [];
  const seenDetail = new Set();
  const seenLink = new Set();

  function pushDetail(group, label, value) {
    label = clean(label).replace(/[:\-–\s]+$/, '');
    value = clean(value);
    if (!label || !value || label.length > 80 || JUNK_LABEL.test(label)) return;
    const key = `${label}|${value}`;
    if (seenDetail.has(key) || details.length >= 60) return;
    seenDetail.add(key);
    details.push({ group: clean(group).slice(0, 60), label, value: value.slice(0, 500) });
  }

  function pushLink(label, href) {
    label = clean(label).replace(/[:\-–\s]+$/, '').slice(0, 80);
    if (!label || !href || SOCIAL.test(href) || seenLink.has(href) || links.length >= 15) return;
    const u = new URL(href);
    const sameHost = u.hostname.replace(/^www\./, '') === baseHost;
    if (sameHost && (u.pathname === '/' || !KEY_LINK.test(label))) return; // skip the site's own menu links
    if (href.split('#')[0] === pageUrl.split('#')[0]) return;
    seenLink.add(href);
    links.push({ label, url: href });
  }

  let group = '';
  let curTable = null;
  let tableHeader = null;
  let rowIdx = 0;

  $('h2,h3,h4,tr').each((_, el) => {
    const $el = $(el);

    if (el.name !== 'tr') {
      if ($el.closest('td,th').length) return;
      const t = clean($el.text());
      if (t && t.length <= 80) group = t;
      return;
    }
    if ($el.find('tr').length) return; // layout row that wraps other tables

    const table = $el.closest('table')[0];
    if (table !== curTable) { curTable = table; tableHeader = null; rowIdx = 0; }
    const isFirst = rowIdx++ === 0;

    const cells = $el.children('td,th').toArray();
    if (!cells.length) return;
    const cellLines = cells.map((c) => lines($, c));
    const texts = cellLines.map((l) => l.join(' '));

    /* links in this row */
    const anchors = $el.find('a[href]').toArray();
    anchors.forEach((a) => {
      const href = absUrl($(a).attr('href'), base);
      if (!href) return;
      const at = clean($(a).text());
      let rowLabel = cells.length > 1 ? texts[0] : '';
      const li = $(a).closest('li,p');
      if (li.length) {
        const ctx = clean(li.text());
        const i = ctx.search(/[:：]/);
        if (i > 1 && i < 80) rowLabel = ctx.slice(0, i);
      }
      let label;
      if (GENERIC_ANCHOR.test(at)) label = rowLabel || at;
      else if (rowLabel && rowLabel !== at && anchors.length > 1 && !rowLabel.includes(at)) label = `${rowLabel} – ${at}`;
      else label = at;
      pushLink(label, href);
    });

    const kvCount = cellLines.flat().filter((l) => kv(l)).length;
    if (anchors.length && kvCount === 0) return; // pure link row

    /* "Label : Value" lines inside cells (lists / <br> separated) */
    if (kvCount) {
      cellLines.forEach((ls) => {
        const g = ls[0] && !kv(ls[0]) && ls[0].length <= 60 ? ls[0] : group;
        ls.forEach((l) => {
          const p = kv(l);
          if (p) pushDetail(g, p.label, p.value);
        });
      });
      return;
    }

    /* plain table rows */
    const looksHeader = texts.every((t) => t.length <= 40 && !/\d/.test(t));
    if (cells.length >= 3) {
      if (!tableHeader && looksHeader && rowIdx <= 2) { tableHeader = texts; return; } // column titles
      const label = texts[0];
      const parts = texts.slice(1).map((t, i) => (t ? (tableHeader && tableHeader[i + 1] ? `${tableHeader[i + 1]}: ${t}` : t) : '')).filter(Boolean);
      pushDetail(group, label, parts.join(' • '));
      return;
    }
    if (cells.length === 2) {
      if (isFirst && looksHeader) return; // a row of two headings, not a pair
      if (texts[0] && texts[1] && texts[0].length <= 80 && texts[1].length <= 400) pushDetail(group, texts[0], texts[1]);
      return;
    }
    if (texts[0] && texts[0].length <= 80) group = texts[0];
  });

  /* fallback: pages that keep their links outside tables */
  if (!links.length) {
    $('a[href]').each((_, a) => {
      if (links.length >= 8) return;
      const href = absUrl($(a).attr('href'), base);
      const at = clean($(a).text());
      if (href && at && at.length <= 80 && KEY_LINK.test(at)) pushLink(at, href);
    });
  }

  /* organisation + the one date worth showing on the card */
  const orgRow = details.find((d) => /^(organi[sz]ation|organi[sz]er|board|commission|department|conducting body)/i.test(d.label));
  const rules = {
    job: [/last\s*date|closing|अंतिम/i, /end\s*date/i],
    admit: [/exam\s*date|परीक्षा/i, /admit/i],
    result: [/result/i],
  };
  const defaultLabel = { job: 'अंतिम तिथि', admit: 'परीक्षा तिथि', result: 'रिज़ल्ट तिथि' };
  let keyDate = '';
  for (const re of rules[category]) {
    const hit = details.find((d) => re.test(d.label) && parseDate(d.value));
    if (hit) { keyDate = parseDate(hit.value); break; }
  }

  return {
    title,
    category,
    org: orgRow ? orgRow.value.slice(0, 120) : '',
    keyDate,
    keyDateLabel: defaultLabel[category],
    details,
    links,
    source: pageUrl,
  };
}

module.exports = { extractPage, parseDate, guessCategory };
