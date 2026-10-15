// =========================================================
// TravelDocs - Preview de la pantalla de carga (datos ficticios
// cosmeticos del pasajero). Script externo: el CSP enforced no
// permite scripts inline y este quedo bloqueado desde el origen.
// =========================================================
  // Datos ficticios del pasajero (cambian en cada inicio de sesion). Cosmetico.
  const SURNAMES = ['GOMEZ','LOPEZ','PEREZ','DIAZ','FERNANDEZ','MARTINEZ','SANCHEZ','ROMERO','SUAREZ','ALVAREZ','TORRES','MOLINA','VEGA','CASTRO','RUIZ'];
  const GIVENS = ['MARIA','JUAN','LUCIA','MATEO','SOFIA','TOMAS','CAMILA','JOAQUIN','VALENTINA','FRANCO','AGUSTINA','NICOLAS','PAULA','DIEGO'];
  const PLACES = ['BUENOS AIRES','CORDOBA','ROSARIO','MENDOZA','LA PLATA','MAR DEL PLATA','TUCUMAN','SALTA'];
  const DOC_PREFIX = ['AAN','AAB','AAC','AAD','AAE','ABN','ACN','ADN'];
  const MONTHS = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];

  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function digs(n) { let s = ''; for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 10); return s; }
  function padR(str, n, ch) { return (str + ch.repeat(n)).slice(0, n); }

  function buildPassenger() {
    const s = pick(SURNAMES), g = pick(GIVENS);
    const doc = pick(DOC_PREFIX) + digs(7);
    const sex = Math.random() < .5 ? 'M' : 'F';
    const yDob = 1960 + Math.floor(Math.random() * 35);
    const mDob = 1 + Math.floor(Math.random() * 12);
    const dDob = 1 + Math.floor(Math.random() * 28);
    const yExp = 2026 + Math.floor(Math.random() * 8);
    const mExp = 1 + Math.floor(Math.random() * 12);
    const dExp = 1 + Math.floor(Math.random() * 28);
    const dobStr = pad2(dDob) + ' ' + MONTHS[mDob - 1] + ' ' + yDob;
    const expStr = pad2(dExp) + ' ' + MONTHS[mExp - 1] + ' ' + yExp;
    // MRZ (cosmetico, sin digitos verificadores reales).
    const dobMrz = String(yDob).slice(-2) + pad2(mDob) + pad2(dDob);
    const expMrz = String(yExp).slice(-2) + pad2(mExp) + pad2(dExp);
    const line1 = padR('P<ARG' + s + '<<' + g, 44, '<');
    const line2 = padR(doc + '<' + digs(1) + 'ARG' + dobMrz + digs(1) + sex + expMrz + digs(1), 44, '<');
    return { s, g, doc, sex, dobStr, expStr, place: pick(PLACES), line1, line2 };
  }

  let pctIv = null;
  function buildGuilloche() {
    const svg = document.getElementById('guilloche');
    if (!svg) return;
    const cx = 220, cy = 150;
    let s = '';
    for (let a = 0; a < 180; a += 6) {
      s += '<ellipse cx="' + cx + '" cy="' + cy + '" rx="135" ry="44" fill="none" stroke="var(--accent)" stroke-width="0.6" transform="rotate(' + a + ' ' + cx + ' ' + cy + ')"/>';
    }
    svg.innerHTML = s;
  }
  function fillStage() {
    buildGuilloche();
    const p = buildPassenger();
    document.getElementById('f-surname').textContent = p.s;
    document.getElementById('f-given').textContent = p.g;
    document.getElementById('f-doc').textContent = p.doc;
    document.getElementById('f-sex').textContent = p.sex === 'M' ? 'MASCULINO' : 'FEMENINO';
    document.getElementById('f-dob').textContent = p.dobStr;
    document.getElementById('f-exp').textContent = p.expStr;
    document.getElementById('f-place').textContent = p.place;
    document.getElementById('mrz-line1').textContent = p.line1;
    document.getElementById('mrz-line2').textContent = p.line2;
    // Contador % cosmetico 0->90.
    const pct = document.getElementById('pass-pct');
    const t0 = Date.now(), D = 1800;
    if (pctIv) clearInterval(pctIv);
    pctIv = setInterval(() => {
      const e = Math.min(1, (Date.now() - t0) / D);
      pct.textContent = Math.round(90 * (1 - Math.pow(1 - e, 3))) + '%';
      if (e >= 1) clearInterval(pctIv);
    }, 30);
  }

  function hide() {
    document.getElementById('app-loading').classList.add('is-hidden');
  }
  function replay() {
    const el = document.getElementById('app-loading');
    el.classList.remove('is-hidden');
    const stage = document.getElementById('scan-stage');
    const clone = stage.cloneNode(true);
    stage.replaceWith(clone);
    fillStage();
  }

  fillStage();

// Botones de control del preview (bind por addEventListener: los onclick
// inline también los bloquea el CSP enforced).
document.getElementById('btn-replay')?.addEventListener('click', replay);
document.getElementById('btn-hide')?.addEventListener('click', hide);
