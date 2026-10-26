export function normHeader(h) {
  return (h || '')
    .toString()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // quita acentos
    .toUpperCase()
    .replace(/[.,]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Mapeo encabezado normalizado -> campo del pasajero
export const EXCEL_HEADER_MAP = (() => {
  const aliases = {
    notes: ['OBSERVACIONES', 'NOTAS'],
    email: ['EMAIL', 'CORREO'],
    emergencyName: ['EMERGENCIA NOMBRE'],
    emergencyRelationship: ['EMERGENCIA PARENTESCO'],
    emergencyPhone: ['EMERGENCIA TELEFONO'],
    lastname:  ['APELLIDO', 'APELLIDOS', 'SURNAME'],
    firstname: ['NOMBRE', 'NOMBRES', 'NAME'],
    dob:       ['FECHA NAC', 'FECHA NACIMIENTO', 'NACIMIENTO', 'FECHANAC', 'FECHA DE NACIMIENTO', 'BIRTHDAY'],
    dniNum:    ['DNI', 'DOC', 'DOCUMENTO', 'NUMERO DNI', 'NRO DNI'],
    dniExp:    ['VTO DNI', 'VENC DNI', 'VENCIMIENTO DNI', 'VENCIMIENTO DOCUMENTO', 'EXPIRACION DNI', 'VTO DOCUMENTO'],
    pargNum:   ['PASAPORTE', 'PASS', 'PAS', 'NUMERO PASAPORTE', 'NRO PASAPORTE', 'PASAPORTE ARG'],
    pargExp:   ['VTO PASS', 'VENC PASS', 'VTO PASAPORTE', 'VENC PASAPORTE', 'VENCIMIENTO PASAPORTE', 'VENC PASAP', 'VTO PASAP'],
    cuil:      ['CUILS', 'CUIL', 'CUIT', 'CUIL CUIT'],
    whatsapp:  ['TELEFONO', 'TEL', 'TELEFONO FIJO', 'CEL', 'CELULAR', 'MOVIL', 'WPP', 'WHATSAPP'],
    direccion: ['DIRECCION', 'DOMICILIO', 'CALLE', 'DIRECC'],
    localidad: ['LOCALIDAD', 'CIUDAD', 'LOCAL'],
    provincia: ['PROVINCIA', 'PROV', 'ESTADO'],
    cp:        ['CODIGO POSTAL', 'CP', 'COD POSTAL', 'CODIGOPOSTAL']
  };
  const m = {};
  for (const [field, list] of Object.entries(aliases)) {
    for (const a of list) m[normHeader(a)] = field;
  }
  return m;
})();

const GROUP_FIELDS = {
  FFN: { AEROLINEA: 'airline', NUMERO: 'number' },
  ASISTENCIA: { NUMERO: 'num', COMPANIA: 'compania', PRODUCTO: 'producto', COBERTURA: 'cobertura', INICIO: 'inicio', FIN: 'fin', DURACION: 'duracion' }
};

export function csvField(header) {
  const h = normHeader(header);
  const m = h.match(/^(FFN|ASISTENCIA) (?:([1-9][0-9]*) )?(.+)$/);
  if (m && GROUP_FIELDS[m[1]][m[3]]) return `${m[1]}.${Number(m[2] || 1)}.${GROUP_FIELDS[m[1]][m[3]]}`;
  return EXCEL_HEADER_MAP[h];
}

// Convierte un valor de fecha del Excel a YYYY-MM-DD.
// Acepta: serial de Excel, objeto Date, ISO, dd/mm/yyyy, formatos GDS (15DEC86,
// 25/DEC/76, 30dec2000) y fecha larga en español ("4 de julio de 1997").
const EXCEL_MONTHS = {
  JAN:1,FEB:2,MAR:3,APR:4,MAY:5,JUN:6,JUL:7,AUG:8,SEP:9,OCT:10,NOV:11,DEC:12,
  ENE:1,ABR:4,AGO:8,DIC:12,SEPT:9,
  ENERO:1,FEBRERO:2,MARZO:3,ABRIL:4,MAYO:5,JUNIO:6,JULIO:7,AGOSTO:8,SEPTIEMBRE:9,OCTUBRE:10,NOVIEMBRE:11,DICIEMBRE:12
};
function excelMonthToNum(name) {
  return EXCEL_MONTHS[String(name).toUpperCase().replace(/\./g, '')];
}
// Solo los nacimientos usan el ano actual como limite hacia el pasado.
function expandYear(yy, isBirthDate) {
  if (yy.length === 4) return yy;
  const n = parseInt(yy, 10);
  const cur = new Date().getFullYear() % 100;
  return String(isBirthDate && n > cur ? 1900 + n : 2000 + n);
}
function normalizeExcelDate(v, isBirthDate = false) {
  if (v == null || v === '') return '';
  if (v instanceof Date) {
    if (isNaN(v)) return '';
    const y = v.getFullYear();
    const mo = String(v.getMonth() + 1).padStart(2, '0');
    const da = String(v.getDate()).padStart(2, '0');
    return `${y}-${mo}-${da}`;
  }
  if (typeof v === 'number') {
    // Serial de Excel: epoch 1899-12-30
    const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
    if (isNaN(d)) return '';
    const y = d.getUTCFullYear();
    const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
    const da = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${mo}-${da}`;
  }
  const s = String(v).trim().replace(/\.+$/, '');
  // ISO YYYY-MM-DD (con o sin hora)
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // dd/mm/yyyy numerico
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const yy = expandYear(m[3], isBirthDate);
    return `${yy}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  // GDS: ddMMMyy / ddMMMyyyy con / opcional (15DEC86, 25/DEC/76, 30dec2000)
  const g = s.match(/^(\d{1,2})\/?([A-Za-zÁÉÍÓÚáéíóú]{3,})\/?(\d{2,4})$/);
  if (g) {
    const mm = excelMonthToNum(g[2]);
    if (mm) return `${expandYear(g[3], isBirthDate)}-${String(mm).padStart(2, '0')}-${g[1].padStart(2, '0')}`;
  }
  // Fecha larga en español: "4 de julio de 1997"
  const es = s.match(/^(\d{1,2})\s+de\s+([A-Za-zÁÉÍÓÚáéíóú]+)\s+de\s+(\d{4})$/);
  if (es) {
    const mm = excelMonthToNum(es[2]);
    if (mm) return `${es[3]}-${String(mm).padStart(2, '0')}-${es[1].padStart(2, '0')}`;
  }
  return s;
}

// Mapea una fila (array por columna) a un objeto pasajero del mismo shape que mapScanToForm.
// fieldOf mapea campo -> indice de columna (number).
export function excelRowToPassenger(row, fieldOf) {
  // Devuelve el valor crudo (conserva tipo number para fechas serial de Excel)
  const raw = field => {
    const idx = fieldOf[field];
    return idx != null && row[idx] != null ? row[idx] : '';
  };
  // Devuelve string limpio para campos de texto
  const txt = field => {
    const v = raw(field);
    return v !== '' ? String(v).trim() : '';
  };
  // Limpia numeros que Excel guarda como float (ej. 31253132.0 -> 31253132)
  const cleanNum = s => String(s).replace(/\.0+$/, '');

  const lastname  = txt('lastname').toUpperCase();
  const firstname = txt('firstname').toUpperCase();
  const dob       = normalizeExcelDate(raw('dob'), true);
  const dniNum    = cleanNum(txt('dniNum'));
  const dniExp    = normalizeExcelDate(raw('dniExp'));
  const pargNum   = cleanNum(txt('pargNum'));
  const pargExp   = normalizeExcelDate(raw('pargExp'));
  const cuil      = cleanNum(txt('cuil'));
  const whatsapp  = cleanNum(txt('whatsapp'));
  const direccion = txt('direccion');
  const localidad = txt('localidad');
  const provincia = txt('provincia');
  const cp        = cleanNum(txt('cp'));

  const mapped = {
    lastname,
    firstname,
    dob,
    gender: 'M',
    nationality: 'ARG',
    doc_type: 'dni',
    cuil,
    whatsapp,
    email: txt('email'),
    emergencyContact: { name: txt('emergencyName'), relationship: txt('emergencyRelationship'), phone: txt('emergencyPhone') }
  };

  if (dniNum) mapped.dni = { num: dniNum, issue: '', exp: dniExp };
  if (pargNum) mapped.parg = { num: pargNum, issue: '', exp: pargExp };

  // Observaciones: direccion + localidad + provincia + cp (el CUIT va en su propio campo)
  const obs = [txt('notes')].filter(Boolean);
  if (direccion) obs.push(`Direccion: ${direccion}`);
  if (localidad) obs.push(`Localidad: ${localidad}`);
  if (provincia) obs.push(`Provincia: ${provincia}`);
  if (cp) obs.push(`CP: ${cp}`);
  if (obs.length) mapped.notes = obs.join(' · ');

  for (const [group, target] of [['FFN', 'ffn'], ['ASISTENCIA', 'asistencias']]) {
    const entries = new Map();
    for (const key of Object.keys(fieldOf)) {
      if (!key.startsWith(group + '.')) continue;
      const [, index, field] = key.split('.');
      const entry = entries.get(Number(index)) || {};
      const value = ['inicio', 'fin'].includes(field) ? normalizeExcelDate(raw(key)) : txt(key);
      entry[field] = ['airline', 'compania'].includes(field) ? value.toUpperCase() : value;
      entries.set(Number(index), entry);
    }
    mapped[target] = [...entries].sort((a, b) => a[0] - b[0]).map(([, entry]) => entry).filter(entry => Object.values(entry).some(Boolean));
  }
  return mapped;
}
