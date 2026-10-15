// ==UserScript==
// @name         PAM · Mi PJ (HP Avada Kedavra)
// @namespace    https://jesleytherabbit-prog.github.io/PAM/
// @version      1.1.0
// @description  Panel con tus grageas, tu ficha, tu bóveda y los roles donde te toca responder; revisa las cuentas de la bóveda antes de publicar y manda todo a PAM.
// @author       Hana Park
// @match        https://hp-avada-kedavra.foroactivo.com/*
// @updateURL    https://jesleytherabbit-prog.github.io/PAM/pam-mi-pj.user.js
// @downloadURL  https://jesleytherabbit-prog.github.io/PAM/pam-mi-pj.user.js
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// ==/UserScript==

/* Solo LEE páginas del foro. Nunca publica ni edita nada: si te avisa de un error en la bóveda,
   el mensaje se envía únicamente si vos tocás «Publicar igual». */
(function () {
  'use strict';
  const W = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  const PAM_URL = 'https://jesleytherabbit-prog.github.io/PAM/';
  const PAM_ORIGIN = 'https://jesleytherabbit-prog.github.io';
  const FICHA_FOROS = [21, 29, 30, 31, 32, 263, 296, 33, 297, 298, 299, 300, 301, 34];
  const BOVEDA_FORO = 175;
  const CACHE_MIN = 30;
  const DIAS_ROL = 60;   /* roles con más días sin movimiento se juntan en «viejos» */
  const NO_ROL = [172, 175, 75, 36, 52, 272, 20, 21, 78, 193, 39, 10, 234, 192, 257];   /* sueldos, bóvedas, misiones (organización), registros… */

  const ud = W._userdata;
  if (!ud || !ud.session_logged_in || !ud.username) return;
  const YO = String(ud.username).trim(), UID = ud.user_id;
  const K = { datos: 'mipj.' + UID, ui: 'mipj.ui', tema: 'mipj.tema', foros: 'mipj.forosRol', ocultos: 'mipj.ocultos.' + UID };

  /* ---------------- utilidades ---------------- */
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const esc = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const num = t => { if (t == null) return null; const m = String(t).replace(/\s/g, '').match(/[+\-−]?\d[\d.,]*/); if (!m) return null; const v = parseInt(m[0].replace('−', '-').replace(/[.,]/g, ''), 10); return isNaN(v) ? null : v; };
  const fmt = n => n == null ? '—' : Number(n).toLocaleString('es-ES');
  const abs = h => h ? new URL(h, location.origin).href : '';
  const gv = (k, d) => { try { const v = GM_getValue(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const sv = (k, v) => GM_setValue(k, JSON.stringify(v));
  const get = async url => { const r = await fetch(url, { credentials: 'same-origin' }); if (!r.ok) throw new Error(r.status + ' ' + url); return new DOMParser().parseFromString(await r.text(), 'text/html'); };
  const FECHA = /((?:Lun|Mar|Miér|Mie|Jue|Vie|Sáb|Sab|Dom)\s+\d{1,2}\s+[A-Za-zé]+\.?(?:\s+\d{4})?\s+-\s+\d{1,2}:\d{2}(?::\d{2})?|(?:Hoy|Ayer)\s+a\s+las\s+\d{1,2}:\d{2}(?::\d{2})?)/;
  const MES = { ene: 0, feb: 1, mar: 2, abr: 3, may: 4, jun: 5, jul: 6, ago: 7, sep: 8, set: 8, oct: 9, nov: 10, dic: 11 };
  function aFecha(t) {
    t = String(t || '');
    let m = t.match(/(Hoy|Ayer)\s+a\s+las\s+(\d{1,2}):(\d{2})/);
    if (m) { const d = new Date(); if (m[1] === 'Ayer') d.setDate(d.getDate() - 1); d.setHours(+m[2], +m[3], 0, 0); return d; }
    m = t.match(/(\d{1,2})\s+([A-Za-zé]+)\.?(?:\s+(\d{4}))?\s+-\s+(\d{1,2}):(\d{2})/);
    if (!m) return null;
    const mes = MES[norm(m[2]).slice(0, 3)]; if (mes == null) return null;
    const hoy = new Date(); const y = m[3] ? +m[3] : hoy.getFullYear();
    let d = new Date(y, mes, +m[1], +m[4], +m[5]); if (!m[3] && d > hoy) d = new Date(y - 1, mes, +m[1], +m[4], +m[5]);
    return d;
  }
  const dias = d => d ? Math.floor((Date.now() - d) / 864e5) : null;
  const haceTxt = d => { const n = dias(d); return n == null ? '' : n <= 0 ? 'hoy' : n === 1 ? 'hace 1 día' : `hace ${n} días`; };

  function postsDe(doc) {
    return [...doc.querySelectorAll('div.post')].filter(e => /^p\d+$/.test(e.id)).map(p => {
      const a = p.querySelector('.author a[href*="/u"]'), au = p.querySelector('.author'), c = p.querySelector('.content') || p;
      return { id: p.id.slice(1), autor: a ? a.textContent.trim() : '', fecha: ((au ? au.textContent : '').match(FECHA) || [''])[0],
        texto: (c.innerText || c.textContent || '').replace(/ /g, ' '), imgs: c.querySelectorAll('img').length, el: c };
    });
  }
  async function paginas(urlTema) {
    const d1 = await get(urlTema);
    const base = urlTema.replace(location.origin, '').split('#')[0].split('?')[0];
    const m = base.match(/^\/t(\d+)(?:p\d+)?-(.*)$/);
    let max = 0;
    if (m) d1.querySelectorAll(`a[href*="/t${m[1]}p"]`).forEach(a => { const x = (a.getAttribute('href') || '').match(new RegExp(`/t${m[1]}p(\\d+)-`)); if (x) max = Math.max(max, +x[1]); });
    if (!max) return { primera: d1, ultimas: [d1] };
    const ult = [await get(`/t${m[1]}p${max}-${m[2]}`)];
    if (max >= 15) { try { ult.unshift(await get(max - 15 ? `/t${m[1]}p${max - 15}-${m[2]}` : `/t${m[1]}-${m[2]}`)); } catch (e) {} }
    return { primera: d1, ultimas: ult };
  }
  const todosLosPosts = P => { const t = []; [P.primera, ...P.ultimas.filter(d => d !== P.primera)].forEach(d => postsDe(d).forEach(p => { if (!t.some(x => x.id === p.id)) t.push(p); })); return t.sort((a, b) => +a.id - +b.id); };
  async function buscarTemas(qs) {
    const d = await get('/search?' + qs);
    return [...d.querySelectorAll('a.topictitle')].map(a => {
      const row = a.closest('tr,li');
      const f = row ? [...row.querySelectorAll('a[href*="/f"]')].map(x => +((x.getAttribute('href') || '').match(/\/f(\d+)-/) || [0, 0])[1]).filter(Boolean) : [];
      return { titulo: a.textContent.trim(), url: abs((a.getAttribute('href') || '').split('?')[0]), foro: f[f.length - 1] || 0 };
    });
  }
  const tidDe = u => +((String(u || '').match(/\/t(\d+)/) || [0, 0])[1]);

  /* ---------------- ficha ---------------- */
  async function leerFicha() {
    const toks = norm(YO).split(' ').filter(t => t.length > 1);
    const cands = (await buscarTemas('search_keywords=' + encodeURIComponent(YO) + '&show_results=topics&search_terms=all&search_fields=titleonly'))
      .filter(t => FICHA_FOROS.includes(t.foro) && toks.every(k => norm(t.titulo).split(' ').includes(k)));
    for (const t of cands) {
      const P = await paginas(t.url);
      const ps = postsDe(P.primera);
      if (!ps.length || norm(ps[0].autor) !== norm(YO)) continue;
      let codigo = '';
      try { const e = await get(`/post?p=${ps[0].id}&mode=editpost`); const ta = e.querySelector('textarea#text_editor_textarea, textarea[name=message]'); if (ta) codigo = ta.value; } catch (e) {}
      if (!codigo) codigo = ps[0].el.innerHTML;
      let sello = null, ultDuenio = null;
      todosLosPosts(P).slice(1).forEach(p => { if (norm(p.autor) === norm(YO)) ultDuenio = p; else if (p.imgs && p.texto.trim().length < 40) sello = p; });
      let estado = t.foro === 21 ? 'pendiente' : 'revisada';
      if (ultDuenio && (!sello || +ultDuenio.id > +sello.id)) estado = 'pendiente';
      return { url: t.url, titulo: t.titulo, foro: t.foro, estado, codigo, sello: sello ? { autor: sello.autor, fecha: sello.fecha } : null };
    }
    return null;
  }

  /* ---------------- bóveda ---------------- */
  const RE_MOV = /Grageas\s+iniciales\s*»?\s*:?\s*([\d.,]+)[\s\S]{0,120}?(?:añaden\s*\/?\s*quitan|Quitan|Añaden)\s*»?\s*:?\s*([+\-−]?\s*[\d.,]+)[\s\S]{0,160}?Grageas\s+actuales\s*»?\s*:?\s*([\d.,]+)[\s\S]{0,80}?Grageas\s+totales\s*»?\s*:?\s*([\d.,]+)/gi;
  const RE_MOV2 = /GRAGEAS\s*Iniciales\s*([\d.,]+)\s*(?:Quitan|Añaden|Añade|Quita)\s*([+\-−]?[\d.,]+)\s*Actuales\s*([\d.,]+)\s*Totales\s*([\d.,]+)/gi;
  const RE_PL = /Puntos\s+Legendarios\s+actuales\s*»?\s*:?\s*([\d.,]+)[\s\S]{0,120}?Puntos\s+Legendarios\s+totales\s*»?\s*:?\s*([\d.,]+)|Puntos\s+Legendarios\s+totales\s*»?\s*:?\s*([\d.,]+)[\s\S]{0,120}?Puntos\s+Legendarios\s+actuales\s*»?\s*:?\s*([\d.,]+)/gi;
  const RE_PL2 = /PUNTOS\s*LEGENDARIOS\s*Iniciales\s*([\d.,]+)\s*(?:Quitan|Añaden)\s*([+\-−]?[\d.,]+)\s*Actuales\s*([\d.,]+)\s*Totales\s*([\d.,]+)/gi;
  async function leerBoveda() {
    const temas = await buscarTemas('search_author=' + encodeURIComponent(YO) + '&search_where=f' + BOVEDA_FORO + '&show_results=topics&search_terms=all');
    for (const t of temas.filter(x => x.foro === BOVEDA_FORO)) {
      const P = await paginas(t.url);
      const p0 = postsDe(P.primera);
      if (!p0.length || norm(p0[0].autor) !== norm(YO)) continue;
      const todos = todosLosPosts(P);
      const movs = []; let act = null, tot = null, pla = null, plt = null, revision = null, nota = null, ini = null;
      const cab = p0[0].texto.match(/Iniciales\s*([\d.,]+)/i); if (cab) ini = num(cab[1]);
      todos.forEach(p => {
        const tuyo = norm(p.autor) === norm(YO), tx = p.texto;
        if (!tuyo && /Revisi[oó]n\s+de\s+B[oó]veda/i.test(tx)) {
          revision = { autor: p.autor, fecha: p.fecha, url: `${t.url.split('#')[0]}#${p.id}` };
          const a = tx.match(/Grageas\s+actuales\s*»?\s*:?\s*([\d.,]+)/i), tt = tx.match(/Grageas\s+totales\s*»?\s*:?\s*([\d.,]+)/i), ii = tx.match(/Grageas\s+iniciales\s*»?\s*:?\s*([\d.,]+)/i);
          if (a) act = num(a[1]); if (tt) tot = num(tt[1]); if (ii && ini == null) ini = num(ii[1]);
          const pa = tx.match(/Puntos\s+Legendarios\s+actuales\s*»?\s*:?\s*([\d.,]+)/i), pt = tx.match(/Puntos\s+Legendarios\s+totales\s*»?\s*:?\s*([\d.,]+)/i);
          if (pa) pla = num(pa[1]); if (pt) plt = num(pt[1]);
          const resto = tx.replace(/\{[^»]*»\s*[^{]*/g, ' ').replace(/\s+/g, ' ').trim();
          nota = resto.length > 6 ? { autor: p.autor, fecha: p.fecha, texto: resto.slice(0, 280) } : null;
          return;
        }
        if (!tuyo) { const t2 = tx.replace(/\s+/g, ' ').trim(); if (t2.length > 6) nota = { autor: p.autor, fecha: p.fecha, texto: t2.slice(0, 280) }; return; }
        [RE_MOV, RE_MOV2].forEach(re => { re.lastIndex = 0; let m; while ((m = re.exec(tx))) { const a = num(m[3]); if (a == null) continue; movs.push({ d: num(m[2]), act: a, fecha: p.fecha }); act = a; const tt = num(m[4]); if (tt != null) tot = tt; } });
        [RE_PL, RE_PL2].forEach(re => { re.lastIndex = 0; let m; while ((m = re.exec(tx))) { if (re === RE_PL2) { pla = num(m[3]); plt = num(m[4]); } else if (m[1]) { pla = num(m[1]); plt = num(m[2]); } else { plt = num(m[3]); pla = num(m[4]); } } });
      });
      const ultTuyo = [...todos].reverse().find(p => norm(p.autor) === norm(YO));
      return { url: t.url, tid: tidDe(t.url), titulo: t.titulo, act, tot, ini, pla, plt, movs: movs.slice(-3).reverse(), revision, nota,
        l1: `${t.url.split('#')[0]}#${p0[0].id}`, l2: ultTuyo ? `${t.url.split('#')[0]}#${ultTuyo.id}` : '', l3: revision ? revision.url : '' };
    }
    return null;
  }

  /* ---------------- roles: dónde te toca responder ---------------- */
  /* un foro es de rol si su ruta pasa por la categoría «Zona del rol» (/c10-) */
  async function esForoDeRol(fid, cache) {
    if (NO_ROL.includes(+fid)) return false;
    if (fid in cache) return cache[fid];
    try { const r = await fetch(`/f${fid}-`, { credentials: 'same-origin' }); const h = await r.text(); cache[fid] = /href="(?:https:\/\/hp-avada-kedavra\.foroactivo\.com)?\/c10-/.test(h); }
    catch (e) { return false; }
    return cache[fid];
  }
  async function leerRoles() {
    const filas = [];
    for (const pag of ['', '/50']) {
      let d; try { d = await get(`/sta/u${UID}${pag}`); } catch (e) { break; }
      d.querySelectorAll('a.topictitle').forEach(a => {
        const row = a.closest('li,tr'); if (!row) return;
        const fA = row.querySelector('.span-tab a[href*="/f"]') || row.querySelector('a[href*="/f"]');
        const fid = +(((fA && fA.getAttribute('href')) || '').match(/\/f(\d+)-/) || [0, 0])[1];
        const lp = row.querySelector('.lastpost'); if (!lp) return;
        const autor = (lp.querySelector('a[href*="/u"]') || {}).textContent || '';
        const ult = lp.querySelector('a[href*="#"]');
        filas.push({ titulo: a.textContent.trim(), url: abs((a.getAttribute('href') || '').split('?')[0]), tid: tidDe(a.getAttribute('href')), fid,
          autor: autor.trim(), fecha: (lp.textContent.match(FECHA) || [''])[0], ultUrl: ult ? abs(ult.getAttribute('href')) : '' });
      });
    }
    const cache = gv(K.foros, {});
    const ajenos = filas.filter(f => f.fid && norm(f.autor) !== norm(YO));
    await Promise.all([...new Set(ajenos.map(f => f.fid))].map(fid => esForoDeRol(fid, cache)));
    const res = [];
    for (const f of ajenos) {
      if (res.some(x => x.tid === f.tid) || !(await esForoDeRol(f.fid, cache))) continue;
      res.push(Object.assign(f, { lpid: +((f.ultUrl.match(/#(\d+)/) || [0, 0])[1]) }));
    }
    sv(K.foros, cache);
    return res.sort((a, b) => (aFecha(a.fecha) || 0) - (aFecha(b.fecha) || 0));
  }

  /* ---------------- tema (el mismo de PAM) ---------------- */
  const TEMA_AVADENSE = { skin: 'avadense', ink: '#171a2b', panel: '#1e2236', 'panel-2': '#262a42', parchment: '#F1EADF', 'parchment-dim': '#a7a1b6', gold: '#B49768',
    'gold-bright': '#d6bd8f', 'arcane-bright': '#cf94a3', good: '#93b8a0', bad: '#d98377', 'line-strong': 'rgba(241,234,223,.16)', 'accent-ink': '#1b1e30',
    serif: '"Cormorant Garamond", Georgia, serif', sans: '"Nunito", system-ui, sans-serif' };
  let tema = Object.assign({}, TEMA_AVADENSE, gv(K.tema, {}));
  const familias = () => [tema.serif, tema.sans].map(f => String(f || '').split(',')[0].replace(/["']/g, '').trim()).filter(f => f && !/^(Georgia|system-ui|serif|sans-serif|monospace)$/i.test(f));
  function cargarFuentes() {
    const fams = [...new Set(['Cormorant Garamond', 'Nunito'].concat(familias()))];
    let l = document.getElementById('mipj-fonts'); if (!l) { l = document.createElement('link'); l.id = 'mipj-fonts'; l.rel = 'stylesheet'; document.head.appendChild(l); }
    l.href = 'https://fonts.googleapis.com/css2?' + fams.map(f => 'family=' + encodeURIComponent(f).replace(/%20/g, '+') + ':ital,wght@0,400;0,600;0,700;1,500').join('&') + '&display=swap';
  }
  let temaEl = null;
  function aplicarTema() {
    if (!temaEl) { temaEl = document.createElement('style'); document.head.appendChild(temaEl); }
    temaEl.textContent = '#mipj,#mipj-modal,.mipj-check{' + Object.entries(tema).filter(([k]) => k !== 'skin').map(([k, v]) => `--m-${k}:${v}`).join(';') + '}';
    document.documentElement.dataset.mipjSkin = tema.skin || 'avadense';
    cargarFuentes();
  }

  const CSS = `
  #mipj,#mipj-modal{--m-r:16px;font-family:var(--m-sans);color:var(--m-parchment);font-size:14px;line-height:1.45;text-align:left}
  #mipj *,#mipj-modal *{box-sizing:border-box}
  #mipj{position:fixed;right:16px;bottom:16px;z-index:99990;width:350px;max-width:calc(100vw - 24px)}
  #mipj .box{position:relative;overflow:hidden;background:radial-gradient(420px 180px at 0% 0%,color-mix(in srgb,var(--m-arcane-bright) 16%,transparent),transparent 70%),linear-gradient(180deg,color-mix(in srgb,var(--m-parchment) 3%,transparent),transparent),var(--m-panel);
    border:1px solid color-mix(in srgb,var(--m-gold) 45%,transparent);border-radius:var(--m-r);box-shadow:0 24px 60px -24px rgba(0,0,0,.75),0 0 0 4px color-mix(in srgb,var(--m-gold) 6%,transparent);max-height:calc(100vh - 32px);display:flex;flex-direction:column}
  #mipj .hd{display:flex;align-items:center;gap:10px;padding:12px 16px 10px;cursor:pointer;user-select:none;border-bottom:1px solid var(--m-line-strong)}
  #mipj .brand{font-family:var(--m-serif);font-style:italic;font-size:20px;color:var(--m-parchment)}
  #mipj .brand i{font-style:normal;color:var(--m-gold-bright);font-size:13px;margin-right:4px}
  #mipj .hd small{margin-left:auto;font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--m-parchment-dim)}
  #mipj .hd .car{color:var(--m-parchment-dim);font-size:11px}
  #mipj .bd{padding:14px 16px 6px;overflow:auto}
  #mipj .nm{font-family:var(--m-serif);font-style:italic;font-weight:500;font-size:26px;line-height:1.1;margin:0;
    background:linear-gradient(100deg,var(--m-gold-bright) 10%,var(--m-parchment) 55%,var(--m-arcane-bright) 95%);-webkit-background-clip:text;background-clip:text;color:transparent}
  #mipj .rule{display:flex;align-items:center;gap:10px;color:var(--m-gold);font-size:11px;margin:8px 0 6px}
  #mipj .rule::before,#mipj .rule::after{content:"";flex:1;height:1px;background:linear-gradient(90deg,transparent,color-mix(in srgb,var(--m-gold) 60%,transparent),transparent)}
  #mipj .big{font-family:var(--m-serif);font-weight:600;font-size:40px;line-height:1;color:var(--m-gold-bright);text-align:center}
  #mipj .big span{font-size:17px;font-style:italic;color:var(--m-parchment-dim);font-weight:500;margin-left:6px}
  #mipj .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:12px 0 4px}
  #mipj .stat{text-align:center;padding:6px 4px;border-radius:10px;background:color-mix(in srgb,var(--m-panel-2) 80%,transparent);border:1px solid var(--m-line-strong)}
  #mipj .stat b{display:block;font-family:var(--m-serif);font-size:17px;font-weight:600;color:var(--m-parchment)}
  #mipj .stat small{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--m-parchment-dim)}
  #mipj .card{margin-top:12px;padding:11px 13px;border-radius:12px;background:color-mix(in srgb,var(--m-panel-2) 70%,transparent);border:1px solid var(--m-line-strong)}
  #mipj .ct{display:flex;align-items:center;gap:8px;font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--m-gold-bright);font-weight:700;margin-bottom:6px}
  #mipj .ct .n{margin-left:auto;letter-spacing:0;font-size:11px;padding:1px 8px;border-radius:999px;background:color-mix(in srgb,var(--m-gold) 18%,transparent);color:var(--m-gold-bright)}
  #mipj a{color:var(--m-gold-bright);text-decoration:none;border-bottom:1px dotted color-mix(in srgb,var(--m-gold) 60%,transparent)}
  #mipj a:hover{color:var(--m-parchment)}
  #mipj .tl{font-family:var(--m-serif);font-size:17px;font-style:italic}
  #mipj .badge{display:inline-flex;align-items:center;gap:6px;margin:6px 0 2px;padding:2px 10px;border-radius:999px;border:1px solid;font-size:11.5px;font-weight:700}
  #mipj .badge.warn{color:var(--m-gold-bright);border-color:var(--m-gold);background:color-mix(in srgb,var(--m-gold) 10%,transparent)}
  #mipj .badge.ok{color:var(--m-good);border-color:var(--m-good);background:color-mix(in srgb,var(--m-good) 10%,transparent)}
  #mipj .row{margin-top:3px;color:var(--m-parchment);font-size:13px}
  #mipj .dim{color:var(--m-parchment-dim);font-size:12.5px}
  #mipj .neg{color:var(--m-bad);font-weight:700}#mipj .pos{color:var(--m-good);font-weight:700}
  #mipj .nota{margin-top:8px;padding:8px 10px;border-radius:10px;border-left:3px solid var(--m-gold);background:color-mix(in srgb,var(--m-gold) 12%,transparent);font-size:12.5px;font-style:italic}
  #mipj .rol{display:flex;gap:8px;align-items:flex-start;padding:7px 0;border-top:1px dashed var(--m-line-strong)}
  #mipj .ct + .rol{border-top:0;padding-top:2px}
  #mipj .rol .rt{flex:1;min-width:0}
  #mipj .rol .rt a{font-family:var(--m-serif);font-size:15.5px;font-style:italic;border:0;line-height:1.2}
  #mipj .rol .d{white-space:nowrap;font-size:11.5px;color:var(--m-parchment-dim);padding-top:2px}
  #mipj .rol .d.old{color:var(--m-bad);font-weight:700}
  #mipj .rol button.x{background:none;border:0;color:var(--m-parchment-dim);padding:2px;font-size:13px;cursor:pointer;line-height:1}
  #mipj .rol button.x:hover{color:var(--m-bad)}
  #mipj .ft{display:flex;align-items:center;gap:8px;padding:10px 16px 12px;border-top:1px solid var(--m-line-strong)}
  #mipj .ft .sp{flex:1;font-size:11px;color:var(--m-parchment-dim);line-height:1.3}
  #mipj button.b,#mipj-modal button.b{font:700 12.5px var(--m-sans);border-radius:999px;padding:8px 14px;cursor:pointer;border:1px solid var(--m-line-strong);background:color-mix(in srgb,var(--m-panel-2) 90%,transparent);color:var(--m-parchment);transition:border-color .2s,transform .2s}
  #mipj button.b:hover,#mipj-modal button.b:hover{border-color:var(--m-gold);transform:translateY(-1px)}
  #mipj button.b.pri,#mipj-modal button.b.pri{background:var(--m-gold);border-color:var(--m-gold);color:var(--m-accent-ink)}
  #mipj button.b:disabled{opacity:.5;cursor:default;transform:none}
  #mipj .err{color:var(--m-bad);font-size:12px;margin:8px 0}
  #mipj .pill{display:flex;align-items:center;gap:10px;margin-left:auto;width:max-content;padding:8px 16px;border-radius:999px;cursor:pointer;
    background:var(--m-panel);border:1px solid color-mix(in srgb,var(--m-gold) 50%,transparent);box-shadow:0 14px 34px -14px rgba(0,0,0,.7)}
  #mipj .pill .brand{font-size:17px}
  #mipj .pill b{font-family:var(--m-serif);font-size:17px;color:var(--m-gold-bright)}
  #mipj .pill .n{font-size:11px;font-weight:700;padding:1px 8px;border-radius:999px;background:var(--m-arcane-bright);color:var(--m-accent-ink)}
  #mipj .pill .dot{width:8px;height:8px;border-radius:50%;background:var(--m-gold-bright)}
  .mipj-check{margin:8px 0;padding:9px 14px;border-radius:12px;font:600 13px var(--m-sans);display:flex;gap:10px;align-items:center;cursor:pointer;text-align:left;
    background:var(--m-panel);color:var(--m-parchment);border:1px solid var(--m-line-strong)}
  .mipj-check .ic{font-family:var(--m-serif);font-size:18px;line-height:1}
  .mipj-check.ok{border-color:color-mix(in srgb,var(--m-good) 60%,transparent)} .mipj-check.ok .ic{color:var(--m-good)}
  .mipj-check.mal{border-color:var(--m-bad)} .mipj-check.mal .ic{color:var(--m-bad)}
  .mipj-check small{color:var(--m-parchment-dim);font-weight:500;margin-left:auto;font-size:11px}
  #mipj-modal{position:fixed;inset:0;z-index:99999;background:rgba(8,7,14,.6);display:flex;align-items:center;justify-content:center;padding:16px}
  #mipj-modal .mb{width:min(520px,100%);max-height:90vh;overflow:auto;border-radius:var(--m-r);padding:20px 22px;background:radial-gradient(500px 200px at 0% 0%,color-mix(in srgb,var(--m-arcane-bright) 14%,transparent),transparent 70%),var(--m-panel);border:1px solid var(--m-gold);box-shadow:0 30px 80px -30px #000}
  #mipj-modal h3{margin:0 0 4px;font-family:var(--m-serif);font-style:italic;font-weight:500;font-size:28px;color:var(--m-gold-bright)}
  #mipj-modal p{margin:6px 0 10px;color:var(--m-parchment-dim)}
  #mipj-modal ul{margin:0 0 14px;padding:0;list-style:none}
  #mipj-modal li{padding:8px 10px;margin:6px 0;border-radius:10px;border-left:3px solid var(--m-bad);background:color-mix(in srgb,var(--m-bad) 10%,transparent);color:var(--m-parchment)}
  #mipj-modal .bt{display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap}
  html[data-mipj-skin="pixel"] #mipj .box,html[data-mipj-skin="pixel"] #mipj .card,html[data-mipj-skin="pixel"] #mipj .stat,html[data-mipj-skin="pixel"] #mipj button.b,html[data-mipj-skin="pixel"] #mipj .pill,html[data-mipj-skin="pixel"] #mipj-modal .mb{border-radius:0}
  @media (max-width:520px){#mipj{right:8px;bottom:8px}}`;

  /* ---------------- panel ---------------- */
  let datos = gv(K.datos, null), cargando = false, error = '';
  const ui = Object.assign({ abierto: window.innerWidth > 600 }, gv(K.ui, {}));
  const ocultos = gv(K.ocultos, {});
  const rolesTodos = () => ((datos && datos.roles) || []).filter(r => !(ocultos[r.tid] && ocultos[r.tid] >= r.lpid));
  const esViejo = r => { const n = dias(aFecha(r.fecha)); return n != null && n > DIAS_ROL; };
  const rolesVisibles = () => rolesTodos().filter(r => !esViejo(r));

  const stEl = document.createElement('style'); stEl.textContent = CSS; document.head.appendChild(stEl);
  aplicarTema();
  const root = document.createElement('div'); root.id = 'mipj'; document.body.appendChild(root);
  const leidoTxt = iso => { try { return new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } };

  function pintar() {
    const B = datos && datos.boveda, F = datos && datos.ficha, R = rolesVisibles();
    const pend = F && F.estado === 'pendiente';
    if (!ui.abierto) {
      root.innerHTML = `<div class="pill" data-a="abrir" title="Abrir Mi PJ"><span class="brand"><i>✦</i>Mi PJ</span>${B && B.act != null ? `<b>${fmt(B.act)}</b>` : ''}${R.length ? `<span class="n" title="Roles donde te toca responder">${R.length}</span>` : ''}${pend ? '<span class="dot" title="Ficha pendiente de revisión"></span>' : ''}</div>`;
      return;
    }
    let h = `<div class="box"><div class="hd" data-a="cerrar" title="Minimizar"><span class="brand"><i>✦</i>Mi PJ</span><small>HP Avada Kedavra</small><span class="car">▾</span></div><div class="bd">`;
    h += `<h3 class="nm">${esc(YO)}</h3>`;
    if (!datos) h += `<p class="dim">${cargando ? 'Leyendo tu ficha, tu bóveda y tus roles…' : 'Tocá «Actualizar» para leer tu ficha y tu bóveda.'}</p>`;
    else {
      if (B) h += `<div class="rule">☾</div><div class="big">${fmt(B.act)}<span>grageas</span></div>
        <div class="stats"><div class="stat"><b>${fmt(B.tot)}</b><small>Totales</small></div><div class="stat"><b>${fmt(B.ini)}</b><small>Iniciales</small></div><div class="stat"><b>${B.pla != null ? fmt(B.pla) + '<span class="dim"> / ' + fmt(B.plt) + '</span>' : '—'}</b><small>Legendarios</small></div></div>`;
      h += `<div class="card"><div class="ct">✒ Te toca responder${R.length ? `<span class="n">${R.length}</span>` : ''}</div>`;
      if (!datos.roles) h += `<div class="dim">${cargando ? 'Buscando…' : 'Tocá «Actualizar».'}</div>`;
      else if (!R.length) h += `<div class="dim">Estás al día con todos tus roles ✦</div>`;
      else h += R.slice(0, ui.todos ? 60 : 5).map(r => { const d = aFecha(r.fecha), n = dias(d);
        return `<div class="rol"><div class="rt"><a href="${esc(r.ultUrl || r.url)}">${esc(r.titulo)}</a><div class="dim">Respondió ${esc(r.autor || 'alguien')}</div></div><span class="d ${n != null && n >= 7 ? 'old' : ''}">${esc(haceTxt(d))}</span><button class="x" data-a="ocultar" data-t="${r.tid}" data-l="${r.lpid}" title="No me toca o ya terminó (vuelve a aparecer si hay un mensaje nuevo)">✕</button></div>`; }).join('')
        + (R.length > 5 ? `<div class="row"><a href="#" data-a="todos">${ui.todos ? 'Ver menos' : `Ver los ${R.length}`}</a></div>` : '');
      const V = rolesTodos().filter(esViejo);
      if (V.length) h += ui.viejos ? `<div class="row dim" style="margin-top:8px">Sin movimiento hace más de ${DIAS_ROL} días:</div>` + V.map(r => `<div class="rol"><div class="rt"><a href="${esc(r.ultUrl || r.url)}">${esc(r.titulo)}</a><div class="dim">Respondió ${esc(r.autor || 'alguien')}</div></div><span class="d">${esc(haceTxt(aFecha(r.fecha)))}</span><button class="x" data-a="ocultar" data-t="${r.tid}" data-l="${r.lpid}" title="Ya terminó">✕</button></div>`).join('') + `<div class="row"><a href="#" data-a="viejos">Ocultar los viejos</a></div>`
        : `<div class="row dim" style="margin-top:6px">y ${V.length} ${V.length === 1 ? 'rol viejo' : 'roles viejos'} (más de ${DIAS_ROL} días quietos) · <a href="#" data-a="viejos">ver</a></div>`;
      h += `</div>`;
      h += `<div class="card"><div class="ct">❖ Ficha</div>${F ? `<a class="tl" href="${esc(F.url)}">${esc(F.titulo)}</a><br>
        <span class="badge ${pend ? 'warn' : 'ok'}">${pend ? '◷ Pendiente de revisión' : '✓ Revisada'}</span>
        <div class="row">${F.sello ? `Último sello: ${esc(F.sello.fecha)}${F.sello.autor ? ` <span class="dim">· ${esc(F.sello.autor)}</span>` : ''}` : 'Todavía sin sello'}</div>
        <div class="dim">Código leído · ${fmt(F.codigo ? F.codigo.length : 0)} caracteres</div>` : '<div class="dim">No encontré tu ficha.</div>'}</div>`;
      h += `<div class="card"><div class="ct">⛁ Bóveda</div>${B ? `<a class="tl" href="${esc(B.url)}">${esc(B.titulo)}</a>
        ${(B.movs || []).map(m => `<div class="row"><span class="${m.d < 0 ? 'neg' : 'pos'}">${m.d == null ? '' : (m.d > 0 ? '+' : '') + fmt(m.d)}</span> → ${fmt(m.act)} <span class="dim">· ${esc(m.fecha)}</span></div>`).join('')}
        ${B.revision ? `<div class="row dim">Última revisión: ${esc(B.revision.autor)}, ${esc(B.revision.fecha)}</div>` : ''}
        ${B.nota ? `<div class="nota">Nota de ${esc(B.nota.autor)}: ${esc(B.nota.texto)}</div>` : ''}` : '<div class="dim">No encontré tu bóveda en el Panel de Bóvedas.</div>'}</div>`;
    }
    if (error) h += `<div class="err">${esc(error)}</div>`;
    h += `</div><div class="ft"><span class="sp">${datos ? 'Leído<br>' + esc(leidoTxt(datos.leido)) : ''}</span>
      <button class="b" data-a="act" ${cargando ? 'disabled' : ''}>${cargando ? 'Leyendo…' : 'Actualizar'}</button>
      <button class="b pri" data-a="pam" ${datos ? '' : 'disabled'} title="Abre PAM y te muestra qué se va a cambiar antes de aplicarlo">Enviar a PAM</button></div></div>`;
    root.innerHTML = h;
  }

  async function actualizar() {
    if (cargando) return; cargando = true; error = ''; pintar();
    try {
      const [ficha, boveda, roles] = await Promise.all([
        leerFicha().catch(e => { console.warn('[Mi PJ] ficha', e); return null; }),
        leerBoveda().catch(e => { console.warn('[Mi PJ] bóveda', e); return null; }),
        leerRoles().catch(e => { console.warn('[Mi PJ] roles', e); return null; })]);
      datos = { v: 2, cuenta: YO, uid: UID, leido: new Date().toISOString(), ficha, boveda, roles };
      sv(K.datos, datos);
    } catch (e) { error = 'No se pudo leer el foro: ' + e.message; }
    cargando = false; pintar();
  }

  function enviarAPam() {
    if (!datos) return;
    const w = window.open(PAM_URL + '#foro', 'pam');
    if (!w) { error = 'El navegador bloqueó la ventana de PAM: permití ventanas emergentes para el foro.'; pintar(); return; }
    let ok = false, n = 0;
    const onMsg = e => {
      if (e.origin !== PAM_ORIGIN || !e.data || !e.data.pamForoOk) return;
      ok = true; window.removeEventListener('message', onMsg);
      if (e.data.tema) { tema = Object.assign({}, TEMA_AVADENSE, e.data.tema); sv(K.tema, e.data.tema); aplicarTema(); pintar(); }
    };
    window.addEventListener('message', onMsg);
    const t = setInterval(() => {
      if (ok || ++n > 60) { clearInterval(t); if (!ok) { error = 'PAM no respondió. ¿Está actualizado a la última versión?'; pintar(); } return; }
      try { w.postMessage({ pamForo: 1, data: datos }, PAM_ORIGIN); } catch (e) {}
    }, 500);
  }

  root.addEventListener('click', e => {
    const a = e.target.closest('[data-a]'); if (!a) return;
    const k = a.dataset.a;
    if (k === 'cerrar') { ui.abierto = false; sv(K.ui, ui); pintar(); }
    else if (k === 'abrir') { ui.abierto = true; sv(K.ui, ui); pintar(); }
    else if (k === 'act') actualizar();
    else if (k === 'pam') enviarAPam();
    else if (k === 'todos') { e.preventDefault(); ui.todos = !ui.todos; sv(K.ui, ui); pintar(); }
    else if (k === 'viejos') { e.preventDefault(); ui.viejos = !ui.viejos; sv(K.ui, ui); pintar(); }
    else if (k === 'ocultar') { ocultos[a.dataset.t] = +a.dataset.l || 1; sv(K.ocultos, ocultos); pintar(); }
  });

  /* ======================= Revisar la bóveda antes de publicar ======================= */
  const limpio = t => String(t || '').replace(/<[^>]+>/g, ' ').replace(/\[\/?[a-z*][^\]]*\]/gi, ' ').replace(/&nbsp;/g, ' ');
  const sumaDelta = t => { const ns = String(t || '').replace(/\([^)]*\)/g, ' ').match(/[+\-−]\s*\d[\d.,]*|\d[\d.,]*/g) || []; return ns.reduce((s, x) => s + (num(x) || 0), 0); };
  function bloques(texto, rotulo) {
    const T = limpio(texto), out = [];
    const re = new RegExp(`${rotulo}\\s+iniciales\\s*»\\s*:?([\\s\\S]*?)(?=${rotulo}\\s+iniciales\\s*»|$)`, 'gi'); let m;
    while ((m = re.exec(T))) {
      const s = m[1], campo = n => { const x = s.match(new RegExp(`${n}\\s*»\\s*:?\\s*([^{\\n]*)`, 'i')); return x ? x[1].trim() : null; };
      out.push({ ini: num(s.split(/[{\n]/)[0]), dTxt: campo(`${rotulo}\\s+que\\s+se\\s+añaden\\s*\\/\\s*quitan`), act: num(campo(`${rotulo}\\s+actuales`)), tot: num(campo(`${rotulo}\\s+totales`)), enl: campo('Enlaces') });
    }
    return out;
  }
  function revisar(texto, ref) {
    const prob = [];
    [['Grageas', 'Grageas', ref && { act: ref.act, tot: ref.tot }], ['Puntos\\s+Legendarios', 'Puntos Legendarios', ref && { act: ref.pla, tot: ref.plt }]].forEach(([rot, nombre, r0]) => {
      const bs = bloques(texto, rot); let prev = r0 && r0.act != null ? r0 : null;
      bs.forEach((b, i) => {
        const n = bs.length > 1 ? ` (movimiento ${i + 1})` : '';
        const d = sumaDelta(b.dTxt);
        if (b.ini == null || b.act == null) { prob.push(`<b>${nombre}${n}:</b> falta algún número del formulario.`); return; }
        if (prev && prev.act != null && b.ini !== prev.act) prob.push(`<b>${nombre}${n}:</b> las iniciales dicen ${fmt(b.ini)}, pero ${i ? 'el movimiento anterior terminó' : 'tu bóveda está'} en ${fmt(prev.act)}.`);
        if (b.ini + d !== b.act) prob.push(`<b>${nombre}${n}:</b> ${fmt(b.ini)} ${d < 0 ? '−' : '+'} ${fmt(Math.abs(d))} da ${fmt(b.ini + d)}, no ${fmt(b.act)}.`);
        if (b.act < 0) prob.push(`<b>${nombre}${n}:</b> quedarías en negativo (${fmt(b.act)}).`);
        if (prev && prev.tot != null && b.tot != null && b.tot !== prev.tot + Math.max(d, 0)) prob.push(`<b>${nombre}${n}:</b> las totales deberían ser ${fmt(prev.tot + Math.max(d, 0))} (lo que gastás no resta de las totales), no ${fmt(b.tot)}.`);
        if (!b.enl || b.enl.replace(/[\s|·✦—-]/g, '').length < 3) prob.push(`<b>${nombre}${n}:</b> faltan los enlaces (son obligatorios).`);
        prev = { act: b.act, tot: b.tot != null ? b.tot : (prev && prev.tot) };
      });
    });
    const inv = limpio(texto).match(/Nuevo\s+inventario\s*»([\s\S]*?)(?:Enlaces\s*»([^{\n]*)|$)/i);
    if (inv && (!inv[2] || inv[2].replace(/[\s|·✦—-]/g, '').length < 3)) prob.push('<b>Inventario:</b> faltan los enlaces (son obligatorios).');
    return prob;
  }
  const tieneFormulario = t => /(Grageas|Puntos\s+Legendarios)\s+iniciales\s*»|Nuevo\s+inventario\s*»/i.test(limpio(t));
  function textoEditor(ta) {
    try { const $ = W.jQuery || W.$; const inst = $ && $(ta).sceditor && $(ta).sceditor('instance'); if (inst && inst.val) return inst.val(); } catch (e) {}
    return ta.value;
  }
  const tidActual = () => { const m = location.pathname.match(/^\/t(\d+)/); if (m) return +m[1]; return +(new URLSearchParams(location.search).get('t') || 0); };
  const refBoveda = () => { const B = datos && datos.boveda; return B && B.tid && B.tid === tidActual() ? B : null; };
  function modal(probs, alSeguir) {
    const m = document.createElement('div'); m.id = 'mipj-modal';
    m.innerHTML = `<div class="mb" role="dialog" aria-modal="true"><h3>Antes de publicar</h3><p>Revisé el formulario de la bóveda y ${probs.length === 1 ? 'hay algo que no cuadra' : `hay ${probs.length} cosas que no cuadran`}:</p>
      <ul>${probs.map(p => `<li>${p}</li>`).join('')}</ul><div class="bt">${alSeguir ? '<button class="b" data-m="seguir">Publicar igual</button>' : ''}<button class="b pri" data-m="volver">${alSeguir ? 'Volver a corregir' : 'Entendido'}</button></div></div>`;
    document.body.appendChild(m);
    m.querySelector('[data-m="volver"]').focus();
    m.addEventListener('click', e => { const b = e.target.closest('[data-m]'); if (e.target === m || (b && b.dataset.m === 'volver')) m.remove(); else if (b && b.dataset.m === 'seguir') { m.remove(); alSeguir(); } });
  }
  function engancharEditor(form) {
    if (form.dataset.mipj) return; form.dataset.mipj = '1';
    const ta = form.querySelector('textarea[name="message"]'); if (!ta) return;
    const bar = document.createElement('div'); bar.className = 'mipj-check'; bar.style.display = 'none';
    (form.querySelector('.sceditor-container') || ta).insertAdjacentElement('afterend', bar);
    let ult = null, probs = [];
    const chequear = () => {
      const t = textoEditor(ta); if (t === ult) return probs; ult = t;
      if (!tieneFormulario(t)) { bar.style.display = 'none'; probs = []; return probs; }
      const ref = refBoveda();
      probs = revisar(t, ref);
      bar.style.display = '';
      bar.className = 'mipj-check ' + (probs.length ? 'mal' : 'ok');
      bar.innerHTML = probs.length ? `<span class="ic">⚠</span>Bóveda: ${probs.length === 1 ? '1 cosa para revisar' : probs.length + ' cosas para revisar'}<small>Mi PJ · tocá para ver</small>`
        : `<span class="ic">✦</span>Bóveda: las cuentas cuadran${ref ? '' : ' (sin comparar con tu bóveda)'}<small>Mi PJ</small>`;
      return probs;
    };
    bar.addEventListener('click', () => { const p = chequear(); if (p.length) modal(p, null); });
    setInterval(chequear, 1500);
    let pasar = false;
    form.addEventListener('submit', e => {
      if (pasar) { pasar = false; return; }
      const sub = e.submitter;
      if (sub && /preview|draft|borrador|previsual/i.test((sub.name || '') + ' ' + (sub.value || ''))) return;
      ult = null; const p = chequear(); if (!p.length) return;
      e.preventDefault(); e.stopImmediatePropagation();
      modal(p, () => { pasar = true; try { form.requestSubmit(sub || undefined); } catch (err) { form.submit(); } });
    }, true);
  }
  const buscarEditores = () => document.querySelectorAll('form').forEach(f => { if (f.querySelector('textarea[name="message"]')) engancharEditor(f); });
  buscarEditores(); setTimeout(buscarEditores, 1500); setTimeout(buscarEditores, 4000);

  pintar();
  const viejo = !datos || datos.v !== 2 || (Date.now() - new Date(datos.leido)) > CACHE_MIN * 60000;
  const enMiBoveda = datos && datos.boveda && datos.boveda.tid === tidActual() && document.querySelector('textarea[name="message"]') && (Date.now() - new Date(datos.leido)) > 2 * 60000;
  if (viejo || enMiBoveda) actualizar();
})();
