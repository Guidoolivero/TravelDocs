// ============================================================
//  loader.js — Pantalla de carga: pasaporte siendo escaneado.
//  Archivo externo (no inline) para cumplir el CSP (script-src 'self').
//  Se carga desde index.html despues del markup del loader.
//  Llena la pagina de datos con info ficticia (cambia en cada inicio
//  de sesion), dibuja el guilloche, arma la zona MRZ y anima el %
//  cosmetico 0->90.
// ============================================================
(function () {
  var SURNAMES = ['GOMEZ','LOPEZ','PEREZ','DIAZ','FERNANDEZ','MARTINEZ','SANCHEZ','ROMERO','SUAREZ','ALVAREZ','TORRES','MOLINA','VEGA','CASTRO','RUIZ'];
  var GIVENS = ['MARIA','JUAN','LUCIA','MATEO','SOFIA','TOMAS','CAMILA','JOAQUIN','VALENTINA','FRANCO','AGUSTINA','NICOLAS','PAULA','DIEGO'];
  var PLACES = ['BUENOS AIRES','CORDOBA','ROSARIO','MENDOZA','LA PLATA','MAR DEL PLATA','TUCUMAN','SALTA'];
  var DOC_PREFIX = ['AAN','AAB','AAC','AAD','AAE','ABN','ACN','ADN'];
  var MONTHS = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];

  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function digs(n) { var s = ''; for (var i = 0; i < n; i++) s += Math.floor(Math.random() * 10); return s; }
  function padR(str, n, ch) { return (str + ch.repeat(n)).slice(0, n); }

  // Si no estan los elementos (otra pagina), no hacer nada.
  if (!document.getElementById('f-surname')) return;

  function buildGuilloche() {
    var svg = document.getElementById('guilloche');
    if (!svg) return;
    var cx = 220, cy = 150, s = '';
    for (var a = 0; a < 180; a += 6) {
      s += '<ellipse cx="' + cx + '" cy="' + cy + '" rx="135" ry="44" fill="none" stroke="var(--accent)" stroke-width="0.6" transform="rotate(' + a + ' ' + cx + ' ' + cy + ')"/>';
    }
    svg.innerHTML = s;
  }

  function buildPassenger() {
    var s = pick(SURNAMES), g = pick(GIVENS);
    var doc = pick(DOC_PREFIX) + digs(7);
    var sex = Math.random() < .5 ? 'M' : 'F';
    var yDob = 1960 + Math.floor(Math.random() * 35);
    var mDob = 1 + Math.floor(Math.random() * 12);
    var dDob = 1 + Math.floor(Math.random() * 28);
    var yExp = 2026 + Math.floor(Math.random() * 8);
    var mExp = 1 + Math.floor(Math.random() * 12);
    var dExp = 1 + Math.floor(Math.random() * 28);
    var dobStr = pad2(dDob) + ' ' + MONTHS[mDob - 1] + ' ' + yDob;
    var expStr = pad2(dExp) + ' ' + MONTHS[mExp - 1] + ' ' + yExp;
    // MRZ cosmetico (sin digitos verificadores reales).
    var dobMrz = String(yDob).slice(-2) + pad2(mDob) + pad2(dDob);
    var expMrz = String(yExp).slice(-2) + pad2(mExp) + pad2(dExp);
    var line1 = padR('P<ARG' + s + '<<' + g, 44, '<');
    var line2 = padR(doc + '<' + digs(1) + 'ARG' + dobMrz + digs(1) + sex + expMrz + digs(1), 44, '<');
    return { s: s, g: g, doc: doc, sex: sex, dobStr: dobStr, expStr: expStr, place: pick(PLACES), line1: line1, line2: line2 };
  }

  var pctIv = null;
  function fillStage() {
    buildGuilloche();
    var p = buildPassenger();
    document.getElementById('f-surname').textContent = p.s;
    document.getElementById('f-given').textContent = p.g;
    document.getElementById('f-doc').textContent = p.doc;
    document.getElementById('f-sex').textContent = p.sex === 'M' ? 'MASCULINO' : 'FEMENINO';
    document.getElementById('f-dob').textContent = p.dobStr;
    document.getElementById('f-exp').textContent = p.expStr;
    document.getElementById('f-place').textContent = p.place;
    document.getElementById('mrz-line1').textContent = p.line1;
    document.getElementById('mrz-line2').textContent = p.line2;

    // Contador % cosmetico 0->90 (no finge 100 antes de cargar la data).
    var pct = document.getElementById('pass-pct');
    var t0 = Date.now(), D = 1800;
    if (pctIv) clearInterval(pctIv);
    pctIv = setInterval(function () {
      var e = Math.min(1, (Date.now() - t0) / D);
      pct.textContent = Math.round(90 * (1 - Math.pow(1 - e, 3))) + '%';
      if (e >= 1) clearInterval(pctIv);
    }, 30);
  }

  fillStage();
})();
