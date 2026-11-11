// ============================================================
//  scanner.js — OCR con Gemini (principal) + Tesseract.js (fallback)
//  Default: gemini-3.5-flash (mejor calidad). Se puede overridear con GEMINI_MODEL.
//  Si GEMINI_API_KEY está configurada usa Gemini; si no, usa Tesseract local.
// ============================================================

// La API key de Gemini vive en Netlify (env vars), nunca en el browser.

let tesseractPromise = null;

async function getTesseract() {
  if (!tesseractPromise) {
    tesseractPromise = (async () => {
      const sources = [
        'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.esm.min.js',
        'https://unpkg.com/tesseract.js@5/dist/tesseract.esm.min.js'
      ];

      let lastError = null;
      for (const src of sources) {
        try {
          return await import(src);
        } catch (err) {
          lastError = err;
        }
      }

      throw new Error(`No se pudo cargar el motor OCR. Verificá conexión/red (${lastError?.message || 'error desconocido'}).`);
    })();
  }
  return tesseractPromise;
}

function resolveRecognize(mod) {
  if (typeof mod?.recognize === 'function') return mod.recognize;
  if (typeof mod?.default?.recognize === 'function') return mod.default.recognize;
  if (typeof mod?.default === 'function') return mod.default;
  return null;
}

// Texto de una foto, en este equipo. No llama a Gemini.
export async function textoDeImagen(file) {
  const recognize = resolveRecognize(await getTesseract());
  if (!recognize) throw new Error('ocr');
  const { data } = await recognize(file, 'spa+eng');
  return (data?.text || '').trim();
}

// Carpeta de importacion masiva: imagenes hasta 4 MB, PDF hasta el tope del lector.
export function archivosImportacionMasiva(files) {
  const maxImagen = 4 * 1024 * 1024;
  const maxPdf = 20 * 1024 * 1024;
  const out = [];
  for (const f of files || []) {
    if (f.type === 'application/pdf') {
      if (f.size <= maxPdf) out.push(f);
    } else if (f.type.startsWith('image/') && f.size <= maxImagen) {
      out.push(f);
    }
  }
  return out;
}

export async function scanDocument(imageFile) {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
  if (!allowedTypes.includes(imageFile.type)) {
    throw new Error('Formato no permitido. Usá JPG, PNG, WebP, GIF o PDF.');
  }
  if (imageFile.size > 20 * 1024 * 1024) {
    throw new Error('El archivo es demasiado grande. Máximo 20MB.');
  }

  // Intentar con la Netlify Function (Gemini en el servidor, key segura)
  try {
    return await scanWithGemini(imageFile);
  } catch (err) {
    const isImage = imageFile.type.startsWith('image/');
    // Si la función no está disponible (ej: desarrollo local), caer a Tesseract
    if (isImage && (err.message?.includes('fetch') || err.message?.includes('404') || err.message?.includes('Failed'))) {
      if (imageFile.size > 4 * 1024 * 1024) throw new Error('La imagen es demasiado grande para OCR local. Máximo 4MB.');
      const recognize = resolveRecognize(await getTesseract());
      if (!recognize) throw new Error('No se pudo inicializar OCR en este navegador.');
      const { data } = await recognize(imageFile, 'spa+eng');
      const text = (data?.text || '').trim();
      if (!text) throw new Error('No se detectó texto legible. Probá con una foto más nítida.');
      return [extractDocumentData(text)];
    }
    throw err; // Errores reales de Gemini (429, etc.) los mostramos al usuario
  }
}

// ── Gemini Vision ────────────────────────────────────────────

async function scanWithGemini(imageFile) {
  // Comprimir imágenes (no PDF) antes de subir: baja latencia, evita timeouts
  // de 30s en la Function y reduce 503 transitorios de Gemini.
  // prepareImageForScan es idempotente (smart-skip) → si ya viene comprimido
  // desde el preview, no se recomprime.
  const prepared = imageFile.type.startsWith('image/') ? await prepareImageForScan(imageFile) : imageFile;
  const base64 = await fileToBase64(prepared);

  // Obtener ID token de Firebase Auth para autenticar la function
  // (import dinámico: mantiene el módulo importable desde node --test)
  const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
  const user = getAuth().currentUser;
  if (!user) throw new Error('Sesión expirada. Volvé a ingresar.');
  const idToken = await user.getIdToken();

  // Llamar a la Netlify Function (proxy seguro, la API key nunca sale del servidor)
  const res = await fetch('/.netlify/functions/gemini-scan', {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${idToken}`
    },
    body:    JSON.stringify({ mimeType: prepared.type, data: base64 })
  });

  const json = await res.json().catch(err => { console.error('scanner: error parseando respuesta del servidor:', err); return {}; });

  if (!res.ok) {
    if (res.status === 429) {
      throw new Error('Límite de Gemini alcanzado. Esperá un minuto e intentá de nuevo.');
    }
    // Errores de capacidad / alta demanda que ahora devuelve el backend de forma amigable
    const backendError = json?.error || '';
    if (backendError.includes('alta demanda') || backendError.includes('high demand')) {
      throw new Error(backendError);
    }
    throw new Error(backendError || `Error al procesar el documento (${res.status}).`);
  }

  const text = json?.text || '';
  if (!text) throw new Error('Gemini no devolvió datos del documento.');

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    console.error('scanner: JSON.parse(text) falló, intentando extraer JSON con regex:', err.message);
    const m = text.match(/\{[\s\S]+\}/);
    if (!m) throw new Error('Respuesta de Gemini no válida.');
    parsed = JSON.parse(m[0]);
  }

  // El prompt devuelve { "documentos": [ ... ] } (1 o más docs de la misma persona).
  // Aceptamos también un objeto suelto o un array suelto por robustez (modelo viejo/fallback).
  let docs;
  if (Array.isArray(parsed)) docs = parsed;
  else if (parsed && Array.isArray(parsed.documentos)) docs = parsed.documentos;
  else docs = [parsed];
  if (!docs.length) docs = [parsed]; // safety: nunca devolver array vacío

  // Normalizar fechas por si Gemini usa otro formato (en cada documento)
  for (const d of docs) {
    d.fecha_nacimiento  = normalizeDate(d.fecha_nacimiento  || '');
    d.fecha_emision     = normalizeDate(d.fecha_emision     || '');
    d.fecha_vencimiento = normalizeDate(d.fecha_vencimiento || '');
    nombresDesdeMrz(d);
  }

  return docs;
}

// Pasaportes y visas: el MRZ separa apellido y nombre con "<<" (un "<" solo
// separa palabras del mismo campo). Con dos apellidos (ej. espanoles) el modelo
// a veces mandaba el segundo apellido a "nombre": si el MRZ es legible, manda.
export function nombresDesdeMrz(doc) {
  const linea = String(doc.mrz || '').split('\n').map(l => l.replace(/\s+/g, '')).find(l => /^[PV]/.test(l) && l.includes('<<'));
  if (!linea) return;
  const [apellido, nombre] = linea.slice(5).split('<<').map(s => s.replace(/<+/g, ' ').trim());
  if (apellido && nombre) Object.assign(doc, { apellido, nombre });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ============================================================
//  Compresión de imágenes pre-upload (Fase 2A)
//  - Lado largo máx 1600px, salida JPEG q0.80, rotación EXIF.
//  - Smart skip: JPEG ya chico (<400KB) no se toca.
//  - PDF y GIF pasan intactos. Si falla el decode, vuelve al original.
//  - Idempotente: un JPEG ya comprimido entra en el smart-skip.
// ============================================================
const SCAN_MAX_LONG_SIDE = 1600;
const SCAN_JPEG_QUALITY = 0.80;
const SCAN_SKIP_BYTES = 400 * 1024;

export async function prepareImageForScan(file) {
  if (!file || !file.type.startsWith('image/')) return file;
  // GIF animado: no recomprimir (rompería animación; OCR igual usa un frame).
  if (file.type === 'image/gif') return file;
  // Smart skip: JPEG ya chico → no hay nada que ganar recomprimiendo.
  if (file.type === 'image/jpeg' && file.size <= SCAN_SKIP_BYTES) return file;

  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const longSide = Math.max(bitmap.width, bitmap.height);
    const scale = longSide > SCAN_MAX_LONG_SIDE ? SCAN_MAX_LONG_SIDE / longSide : 1;
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        b => (b ? resolve(b) : reject(new Error('canvas.toBlob devolvió null'))),
        'image/jpeg',
        SCAN_JPEG_QUALITY
      );
    });

    const out = new File([blob], replaceExt(file.name, '.jpg'), { type: 'image/jpeg' });
    console.log(`scan: ${Math.round(file.size / 1024)}KB → ${Math.round(out.size / 1024)}KB (${w}x${h})`);
    return out;
  } catch (err) {
    console.warn('scan: compresión falló, usando original:', err?.message || err);
    return file;
  }
}

function replaceExt(name, ext) {
  const base = String(name || 'scan').replace(/\.[^.]+$/, '');
  return base + ext;
}

// ============================================================
//  Procesamiento de logo de agencia (para el admin de branding)
//  - Lado largo máx 400px, mantiene aspecto, rota por EXIF.
//  - PNG/WebP/GIF → salida PNG (preserva transparencia); JPEG → JPEG q0.92.
//  - Devuelve un data: URL listo para guardar en branding.logoUrl (Firestore).
//  - Tope ~200KB: si excede, rebaja calidad/dimensión un paso.
// ============================================================
const LOGO_MAX_LONG_SIDE = 400;
const LOGO_MAX_BYTES = 200 * 1024;

export async function prepareLogoDataUrl(file) {
  if (!file || !file.type.startsWith('image/')) {
    throw new Error('El logo debe ser una imagen (PNG, JPEG o WebP).');
  }
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const longSide = Math.max(bitmap.width, bitmap.height);
    const scale = longSide > LOGO_MAX_LONG_SIDE ? LOGO_MAX_LONG_SIDE / longSide : 1;
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, w, h);

    // PNG si el origen tiene transparencia (png/webp/gif); si no, JPEG.
    const isTransparent = file.type === 'image/png' || file.type === 'image/webp' || file.type === 'image/gif';
    const outType = isTransparent ? 'image/png' : 'image/jpeg';
    let dataUrl = canvas.toDataURL(outType, 0.92);

    // Si quedó muy pesado y es JPEG, bajamos calidad; si es PNG, reintentamos a 300px.
    if (dataUrl.length > LOGO_MAX_BYTES) {
      if (outType === 'image/jpeg') {
        dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      } else {
        const s = (LOGO_MAX_LONG_SIDE * 0.75) / longSide;
        const cw = Math.max(1, Math.round(bitmap.width * s));
        const ch = Math.max(1, Math.round(bitmap.height * s));
        canvas.width = cw; canvas.height = ch;
        ctx.drawImage(bitmap, 0, 0, cw, ch);
        dataUrl = canvas.toDataURL('image/png');
      }
    }
    return dataUrl;
  } finally {
    bitmap.close?.();
  }
}

function extractDocumentData(rawText) {
  const text = normalizeText(rawText);
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  const mrz = extractMrz(lines);
  const inferredType = inferType(text, mrz);

  const passportIssueDate = extractDateNearLabel(text, /(DATE\s*OF\s*ISSUE|FECHA\s*DE\s*EMISI[OÓ]N)/);
  const passportExpiryDate = extractDateNearLabel(text, /(DATE\s*OF\s*EXPIRY|FECHA\s*DE\s*VENCIMIENTO|EXPIRA)/);

  const visaCandidate = extractVisaNumber(text);
  // Para visas: el MRZ es más confiable que el texto porque emisión y vencimiento
  // suelen estar en la misma línea OCR y el text-based toma la primera fecha (emisión).
  const visaExpiryDate = pickFirst([
    mrz?.dateOfExpiry || '',
    extractDateNearLabel(text, /(EXPIRATION\s*DATE|DATE\s*OF\s*EXPIRY|FECHA\s*DE\s*VENCIMIENTO|EXPIRA)/)
  ]);
  const visaIssueDate = normalizeVisaIssueDate(
    pickFirst([
      extractVisaIssueDate(text),
      extractDateNearLabel(text, /(ISSUE\s*DATE|FECHA\s*DE\s*EMISION)/),
      mrz?.dateOfIssue || ''
    ]),
    visaExpiryDate
  );

  const dniCandidate = pickFirst([
    extractPassportPersonalNumber(text),
    extractDniNumber(text)
  ]);
  const passportCandidate = pickFirst([
    extractPassportNumber(text),
    mrz?.documentNumber
  ]);

  const primaryNumber = selectPrimaryNumber({
    tipo: inferredType,
    visaCandidate,
    passportCandidate,
    dniCandidate,
    fallback: getFieldByLabel(text, /(PASSPORT\s*NO|PASAPORTE|DOCUMENTO|NRO\.?\s*DOC|N[UÚ]MERO)\s*[:#\-]?\s*([A-Z0-9\.]{6,15})/, 2)
  });

  const genericIssueDate = normalizeDate(getFieldByLabel(text, /(FECHA\s*DE\s*EMISI[OÓ]N|DATE\s*OF\s*ISSUE)\s*[:\-]?\s*([0-9A-Z\/\-. ]{6,24})/, 2));
  const genericExpiryDate = normalizeDate(getFieldByLabel(text, /(FECHA\s*DE\s*VENCIMIENTO|DATE\s*OF\s*EXPIRY|EXPIRA)\s*[:\-]?\s*([0-9A-Z\/\-. ]{6,24})/, 2));

  const result = {
    tipo: inferredType,
    apellido: pickFirst([
      extractNameField(text, /APELLIDO[S]?\s*(?:\/\s*SURNAME)?/),
      mrz?.surname
    ]),
    nombre: pickFirst([
      extractNameField(text, /NOMBRES?\s*(?:\/\s*GIVEN\s*NAMES?)?/),
      extractNameField(text, /GIVEN\s*NAMES?/),
      extractNameField(text, /:\s*NAMES?\b/),
      mrz?.givenNames
    ]),
    numero: primaryNumber,
    numero_pasaporte: passportCandidate,
    numero_dni: dniCandidate,
    fecha_nacimiento: pickFirst([
      extractDateNearLabel(text, /(FECHA\s*DE\s*NACIMIENTO|DATE\s*OF\s*BIRTH)/),
      mrz?.dateOfBirth
    ]),
    fecha_emision: inferredType === 'VISA'
      ? visaIssueDate
      : (inferredType === 'PASAPORTE'
        ? pickFirst([passportIssueDate, genericIssueDate])
        : pickFirst([genericIssueDate, extractDateNearLabel(text, /(DATE\s*OF\s*ISSUE|FECHA\s*DE\s*EMISION)/)])),
    fecha_vencimiento: inferredType === 'VISA'
      ? pickFirst([visaExpiryDate, mrz?.dateOfExpiry])
      : (inferredType === 'PASAPORTE'
        ? pickFirst([mrz?.dateOfExpiry, passportExpiryDate, genericExpiryDate])
        : pickFirst([genericExpiryDate, mrz?.dateOfExpiry])),
    sexo: pickFirst([
      normalizeSex(getFieldByLabel(text, /(SEXO|SEX)\s*[:\-]?\s*(M|F|MASCULINO|FEMENINO)/, 2)),
      mrz?.sex
    ]),
    nacionalidad: pickFirst([
      normalizeNationality(getFieldByLabel(text, /(NACIONALIDAD|NATIONALITY)\s*[:\-]?\s*([A-Z]{3}|[A-Z ]{4,})/, 2)),
      mrz?.nationality
    ]),
    pais_emisor: pickFirst([
      normalizeNationality(getFieldByLabel(text, /(PA[IÍ]S\s*EMISOR|ISSUING\s*COUNTRY)\s*[:\-]?\s*([A-Z]{3}|[A-Z ]{4,})/, 2)),
      mrz?.issuer
    ]),
    pais_destino_visa: extractVisaCountry(text, mrz),
    lugar_emision: extractIssuingPost(text, mrz),
    tipo_visa: extractVisaType(text, mrz)
  };

  if (result.tipo === 'DNI' && !result.pais_emisor) result.pais_emisor = 'ARG';
  if (!result.nacionalidad && result.pais_emisor) result.nacionalidad = result.pais_emisor;
  if (!result.apellido || !result.nombre) {
    const fallbackNames = extractFallbackNames(text);
    if (!result.apellido && fallbackNames.surname) result.apellido = fallbackNames.surname;
    if (!result.nombre && fallbackNames.givenNames) result.nombre = fallbackNames.givenNames;
  }

  return result;
}

function inferType(text, mrz) {
  if (mrz?.type === 'V') return 'VISA';
  if (mrz?.type === 'P') return 'PASAPORTE';
  if (/\bVISA\b|VISA\s*TYPE|CONTROL\s*NUMBER|ISSUING\s*POST/.test(text)) return 'VISA';
  // B1/B2 (turista USA) puede aparecer sin la palabra VISA si el OCR falla en esa zona
  if (/\bB[1I]\s*\/?\s*B2\b|\bB[1I]\b/.test(text)) return 'VISA';
  if (/ESTA|ELECTRONIC SYSTEM FOR TRAVEL AUTHORIZATION|AUTHORIZATION APPROVED|VISA WAIVER PROGRAM.*NOT A VISA/i.test(text)) return 'ESTA';
  if (/PASAPORTE|PASSPORT/.test(text)) return 'PASAPORTE';
  if (/\bDNI\b|DOCUMENTO\s+NACIONAL\s+DE\s+IDENTIDAD/.test(text)) return 'DNI';
  return 'DNI';
}

function extractMrz(lines) {
  const candidates = lines
    .map(l => l.replace(/\s+/g, ''))
    .filter(l => /^[A-Z0-9<]{30,44}$/.test(l));

  if (candidates.length < 2) return null;
  const l1 = candidates[candidates.length - 2];
  const l2 = candidates[candidates.length - 1];
  if (!l1 || !l2 || l1.length < 40 || l2.length < 40) return null;

  const namesRaw = l1.slice(5).split('<<');
  const surname = (namesRaw[0] || '').replace(/<+/g, ' ').trim();
  const givenNames = (namesRaw[1] || '').replace(/<+/g, ' ').trim();

  const tail = l2.slice(27);
  const visaClass = (tail.match(/[BTSI]/) || [])[0] || '';
  const issuingPostCode = (tail.match(/[BTSI][0-9A-Z]?([A-Z]{3})/) || [])[1] || '';

  return {
    type: l1[0],
    issuer: sanitizeCode(l1.slice(2, 5)),
    surname,
    givenNames,
    documentNumber: sanitizeDocNumber(l2.slice(0, 9)),
    nationality: sanitizeCode(l2.slice(10, 13)),
    dateOfBirth: mrzDateToIso(l2.slice(13, 19), true),
    sex: normalizeSex(l2.slice(20, 21)),
    dateOfExpiry: mrzDateToIso(l2.slice(21, 27), false),
    visaClass,
    issuingPostCode
  };
}

function normalizeText(s) {
  return (s || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9<\n\/\.\-: ]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function extractDniNumber(text) {
  const m = text.match(/\b\d{2}[\.]?\d{3}[\.]?\d{3}\b/);
  if (!m) return '';
  return m[0].replace(/\./g, '');
}

function extractPassportPersonalNumber(text) {
  const m = text.match(/(DNI\s*\/\s*PERSONAL\s*NUMBER|PERSONAL\s*NUMBER|DNI)\s*[:\-]?\s*([0-9]{7,9})/);
  return m?.[2] || '';
}

function extractPassportNumber(text) {
  // Buscar cerca del label Número/Number
  const direct = text.match(/(NUMERO\s*[\/]?\s*NUMBER|PASSPORT\s*NO|NO\.?\s*PASSPORT)\s*[:\-]?\s*([A-Z]{2,3}[0-9]{5,8})/);
  if (direct?.[2]) return direct[2];

  // Buscar en el bloque del pasaporte, solo el patrón exacto de num ARG (2-3 letras + 6-7 dígitos)
  // sin capturar palabras como PASAPORTE, SURNAME, etc.
  const inBlock = text.match(/(?:PASAPORTE|PASSPORT)[\s\S]{0,200}?\b([A-Z]{2,3}[0-9]{6,7})\b/);
  if (inBlock?.[1]) return inBlock[1];

  return '';
}

function selectPrimaryNumber({ tipo, visaCandidate, passportCandidate, dniCandidate, fallback }) {
  const cleanFallback = sanitizeDocNumber(fallback || '');
  if (tipo === 'VISA') {
    // NUNCA usar passportCandidate como número de visa: ese número es del pasaporte del titular
    return pickFirst([
      sanitizeDocNumber(visaCandidate),
      // Solo usar fallback si parece número de visa (empieza con letra seguida de dígitos, o solo dígitos largos)
      /^[TV][0-9]{6,9}$/.test(cleanFallback) || /^[0-9]{10,20}$/.test(cleanFallback) ? cleanFallback : ''
    ]);
  }

  if (tipo === 'PASAPORTE') {
    return pickFirst([
      sanitizeDocNumber(passportCandidate),
      /^[A-Z].*\d/.test(cleanFallback) ? cleanFallback : '',
      sanitizeDocNumber(passportCandidate),
      cleanFallback
    ]);
  }

  return pickFirst([
    sanitizeDocNumber(dniCandidate),
    sanitizeDocNumber(cleanFallback),
    sanitizeDocNumber(passportCandidate)
  ]);
}

function extractFallbackNames(text) {
  const m = text.match(/([A-Z]{2,})\s*,\s*([A-Z ]{2,})/);
  if (!m) return { surname: '', givenNames: '' };
  return { surname: m[1].trim(), givenNames: m[2].trim() };
}

// Extrae un nombre/apellido después de una etiqueta bilingüe.
// En pasaportes ARG el valor siempre está en la línea siguiente al label.
function extractNameField(text, labelRegex) {
  const lines = String(text || '').split('\n');
  // Palabras que indican etiqueta, no un nombre real (incluye variantes OCR como SUMAME por SURNAME)
  const esEtiqueta = /^(APELLIDO|NOMBRE|SURNAME|SURNAM|SUMAME|GIVEN|DNI|PERSONAL|FECHA|DATE|NACIMIENTO|BIRTH|NACIONA|NATION|SEXO|SEX|LUGAR|PLACE|TIPO|TYPE|PAIS|COUNTRY|NUMERO|NUMBER|EMISION|ISSUE|VENCIM|EXPIR|AUTORI|RENAPER|PASAPORTE|PASSPORT|REPUBLICA|ARGENTINA|MERCOSUR|AUTORIDAD|AUTHORITY)/;

  for (let i = 0; i < lines.length; i++) {
    if (!labelRegex.test(lines[i])) continue;

    // Buscar en las siguientes 1-3 líneas el primer valor que parezca un nombre real
    for (let j = i + 1; j <= i + 3 && j < lines.length; j++) {
      const candidate = lines[j].trim();
      if (!candidate) continue;
      if (esEtiqueta.test(candidate)) continue;
      // Debe ser solo letras y espacios (nombre real), al menos 2 caracteres
      if (/^[A-Z][A-Z ]{1,}$/.test(candidate)) {
        // Filtrar palabras de ruido OCR: menos de 3 chars, o todas la misma letra (ej: "EEE", "III", "UA")
        const words = candidate.split(/\s+/).filter(w =>
          w.length >= 3 && !/^(.)\1+$/.test(w)
        );
        if (words.length > 0) return words.join(' ');
      }
    }
  }
  return '';
}

function getFieldByLabel(text, regex, group = 1) {
  const m = text.match(regex);
  return m?.[group]?.trim() || '';
}

function pickFirst(values) {
  for (const v of values) {
    if (v && String(v).trim()) return String(v).trim();
  }
  return '';
}

function normalizeDate(raw) {
  if (!raw) return '';
  const s = String(raw).trim().toUpperCase();

  // Normalizar ruido OCR frecuente: "MAR/MAR" o separadores mixtos.
  const sNormalized = s
    .replace(/([A-Z]{3})\s*\/\s*\1/g, '$1')
    .replace(/([A-Z]{3})\s*\-\s*\1/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

  const compact = sNormalized.replace(/\s+/g, '');

  let m = sNormalized.match(/^([0-9OQILSB]{4})[\-\/.]([0-9OQILSB]{2})[\-\/.]([0-9OQILSB]{2})$/);
  if (m) {
    const y = fixOcrDigits(m[1]);
    const mo = fixOcrDigits(m[2]);
    const d = fixOcrDigits(m[3]);
    return `${y}-${mo}-${d}`;
  }

  m = sNormalized.match(/^([0-9OQILSB]{2})[\-\/.]([0-9OQILSB]{2})[\-\/.]([0-9OQILSB]{4})$/);
  if (m) {
    const d = fixOcrDigits(m[1]);
    const mo = fixOcrDigits(m[2]);
    const y = fixOcrDigits(m[3]);
    return `${y}-${mo}-${d}`;
  }

  m = sNormalized.match(/^([0-9OQILSB]{2})([0-9OQILSB]{2})([0-9OQILSB]{4})$/);
  if (m) {
    const d = fixOcrDigits(m[1]);
    const mo = fixOcrDigits(m[2]);
    const y = fixOcrDigits(m[3]);
    return `${y}-${mo}-${d}`;
  }

  m = sNormalized.match(/^(\d{1,2})\s*([A-Z]{3})\s*(\d{2,4})$/);
  if (!m) m = compact.match(/^(\d{1,2})([A-Z]{3})(\d{2,4})$/);
  if (m) {
    const day = fixOcrDigits(m[1]).padStart(2, '0');
    const mm = monthToNumber(m[2]);
    let year = fixOcrDigits(m[3]);
    if (year.length === 2) {
      const y = Number(year);
      const currentYear = new Date().getFullYear();
      // Si 2000+y supera el año actual +14 (más allá del máximo vencimiento razonable),
      // es una fecha de nacimiento del siglo pasado. Ej: 41→1941, 57→1957, 31→2031, 33→2033.
      year = String((2000 + y) > (currentYear + 14) ? 1900 + y : 2000 + y);
    }
    if (mm) return `${year}-${mm}-${day}`;
  }

  return '';
}

function extractDateNearLabel(text, labelRegex) {
  const line = getLineByLabel(text, labelRegex);
  return normalizeDate(extractFirstDateToken(line));
}

function getLineByLabel(text, labelRegex) {
  const lines = String(text || '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (labelRegex.test(line)) {
      // A veces OCR separa la fecha en la línea siguiente.
      return `${line} ${lines[i + 1] || ''}`;
    }
  }
  return '';
}

function extractFirstDateToken(s) {
  // Normalizar formato bilingüe "MAR/MAR" o "MAR-MAR" antes de buscar patrones
  const str = String(s || '').toUpperCase()
    .replace(/([A-Z]{3})\s*\/\s*\1/g, '$1')
    .replace(/([A-Z]{3})\s*-\s*\1/g, '$1')
    // Eliminar letra suelta de ruido OCR entre mes y año: "FEB B 57" → "FEB 57"
    .replace(/([A-Z]{3})\s+[A-Z]\s+(\d)/g, '$1 $2');
  const patterns = [
    /(\d{4}[\-\/.]\d{2}[\-\/.]\d{2})/,
    /(\d{2}[\-\/.]\d{2}[\-\/.]\d{4})/,
    /(\d{1,2}\s*[A-Z]{3}\s*\d{2,4})/,
    /(\d{2}[A-Z]{3}\d{2,4})/,
    /([0-9OQILSB]{1,2}\s*[A-Z]{3}\s*[0-9OQILSB]{2,4})/,
    /([0-9OQILSB]{2}[A-Z]{3}[0-9OQILSB]{2,4})/
  ];

  for (const p of patterns) {
    const m = str.match(p);
    if (m?.[1]) return m[1];
  }
  return '';
}

function monthToNumber(mon) {
  const m = String(mon || '').toUpperCase();
  const map = {
    JAN: '01', ENE: '01',
    FEB: '02',
    MAR: '03',
    APR: '04', ABR: '04',
    MAY: '05',
    JUN: '06',
    JUL: '07',
    AUG: '08', AGO: '08',
    SEP: '09', SET: '09',
    OCT: '10',
    NOV: '11',
    DEC: '12', DIC: '12'
  };
  return map[m] || '';
}

function extractVisaNumber(text) {
  // CONTROL NUMBER puede estar en la siguiente línea al label (OCR separa label/valor)
  const control = text.match(/CONTROL\s*[\n ]?NUMBER[\s\S]{0,40}?([0-9]{10,20})/);
  if (control?.[1]) return control[1];

  // Foil number: puede empezar con T o V (ej: T1382233, V4784660)
  const foil = text.match(/\b[TV][0-9]{6,9}\b/);
  if (foil?.[0]) return foil[0];

  // MRZ: para visas el número de documento está en los primeros 9 chars de línea 2
  const mrzLines = text.split('\n')
    .map(l => l.replace(/\s+/g, ''))
    .filter(l => /^[A-Z0-9<]{40,44}$/.test(l));
  if (mrzLines.length >= 2) {
    const l2 = mrzLines[mrzLines.length - 1];
    const docNum = sanitizeDocNumber(l2.slice(0, 9));
    if (docNum) return docNum;
  }

  return '';
}

function extractVisaIssueDate(text) {
  const line = getLineByLabel(text, /ISSUE\s*DATE/);
  const token = extractFirstDateToken(line);
  // Solo cortar si normalizeDate realmente encontró una fecha válida
  const fromLine = token ? normalizeDate(token) : '';
  if (fromLine) return fromLine;

  // Fallback: buscar en el texto completo con contexto amplio.
  // El OCR de visas puede separar el label del valor por varias líneas de ruido.
  const m = text.match(/ISSUE\s*DATE[\s\S]{0,80}?(\d{1,2}[A-Z]{3}\d{4})/);
  if (m?.[1]) return normalizeDate(m[1]);

  return '';
}

function normalizeVisaIssueDate(issue, expiry) {
  if (!issue) return '';
  const parsedIssue = parseIso(issue);
  const parsedExpiry = parseIso(expiry);
  if (!parsedIssue) return '';

  const currentYear = new Date().getFullYear();
  let y = parsedIssue.y;
  const m = String(parsedIssue.m).padStart(2, '0');
  const d = String(parsedIssue.d).padStart(2, '0');

  // Si OCR dejó la fecha de emisión en el futuro, corregimos usando vencimiento típico de visa (10 años).
  if (y > currentYear + 1 && parsedExpiry) {
    const candidate = parsedExpiry.y - 10;
    if (candidate >= 1990 && candidate <= currentYear + 1) {
      y = candidate;
      return `${y}-${m}-${d}`;
    }
  }

  // Si quedó posterior al vencimiento, también corregimos con vencimiento - 10 años.
  if (parsedExpiry) {
    const issueTs = Date.parse(`${y}-${m}-${d}`);
    const expiryTs = Date.parse(`${parsedExpiry.y}-${String(parsedExpiry.m).padStart(2, '0')}-${String(parsedExpiry.d).padStart(2, '0')}`);
    if (Number.isFinite(issueTs) && Number.isFinite(expiryTs) && issueTs > expiryTs) {
      const candidate = parsedExpiry.y - 10;
      if (candidate >= 1990 && candidate <= currentYear + 1) {
        return `${candidate}-${m}-${d}`;
      }
    }
  }

  return `${y}-${m}-${d}`;
}

function parseIso(v) {
  const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

function extractVisaCountry(text, mrz) {
  if (/UNITED\s+STATES|AMERICA|\bUSA\b/.test(text)) return 'USA';
  if (mrz?.type === 'V' && mrz?.issuer) return mrz.issuer;
  return '';
}

function extractIssuingPost(text, mrz) {
  if (/BUENOS\s+AIRES/.test(text)) return 'BUENOS AIRES, ARGENTINA';

  let issuing = pickFirst([
    getFieldByLabel(text, /ISSUING\s*POST\s*NAME\s*[:\-]?\s*([A-Z ]{3,}?)(?=\s+(CONTROL\s*NUMBER|SURNAME|GIVEN\s*NAME|VISA\s*TYPE|SEX|BIRTH\s*DATE|NATIONALITY|$))/),
    getFieldByLabel(text, /LUGAR\s*DE\s*EMISION\s*[:\-]?\s*([A-Z ]{3,})/)
  ]);

  if (!issuing) {
    const line = getLineByLabel(text, /ISSUING\s*POST\s*NAME/);
    issuing = line.replace(/.*ISSUING\s*POST\s*NAME\s*/,'').trim();
  }

  issuing = issuing
    .replace(/CONTROL\s*NUMBER.*$/,'')
    .replace(/VISA\s*TYPE.*$/,'')
    .replace(/\bPEO\b/g, '')
    .replace(/\s{2,}/g,' ')
    .trim();

  if (!issuing && mrz?.issuingPostCode === 'BNS') return 'BUENOS AIRES, ARGENTINA';
  if (/BUENOS\s+AIRES/.test(issuing)) return 'BUENOS AIRES, ARGENTINA';
  return issuing;
}

function extractVisaType(text, mrz) {
  // OCR puede confundir "1" con "I", o separar con espacio: "B 1/B 2"
  const textNorm = text.replace(/B\s*1/g, 'B1').replace(/B\s*I/g, 'B1');
  // B1/B2 = Turista/Negocios — verificar antes que nada
  if (/\bB1\s*\/?\s*B2\b|\bB1\b|\bB2\b/.test(textNorm)) return 'T';
  if (/\bF1\b|\bF2\b|\bSTUDENT\b/.test(text)) return 'S';

  // Capturar el valor del campo VISA TYPE/CLASS
  const typed = getFieldByLabel(text, /VISA\s*TYPE\s*\/?\s*CLASS\s*[:\-]?\s*([A-Z0-9\/]{1,8})/);
  if (typed) {
    const typedNorm = typed.replace(/[1I]/g, '1');
    if (/B1|B2/.test(typedNorm)) return 'T';
    if (typed.startsWith('B')) return 'T';
    if (typed.startsWith('T')) return 'T';
    if (typed.startsWith('S')) return 'S';
    // Solo "I" como clase si es exactamente I (no si aparece dentro de otra string)
    if (/^I$/.test(typed.trim())) return 'I';
  }

  // MRZ visaClass: solo si es inequívoco (B→T, S→S) — la 'I' del MRZ es muy propensa a ruido
  if (mrz?.visaClass === 'B') return 'T';
  if (mrz?.visaClass === 'S') return 'S';
  // NO usar visaClass === 'I' porque la zona opcional del MRZ suele contener 'I' de nombres

  if (mrz?.type === 'V') return 'T';

  return 'T';
}

function fixOcrDigits(v) {
  return String(v || '')
    .replace(/[OQ]/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/S/g, '5')
    .replace(/B/g, '8');
}

function mrzDateToIso(yymmdd, isBirth) {
  if (!/^\d{6}$/.test(yymmdd || '')) return '';
  const yy = Number(yymmdd.slice(0, 2));
  const mm = yymmdd.slice(2, 4);
  const dd = yymmdd.slice(4, 6);
  const nowYear = new Date().getFullYear() % 100;
  const century = isBirth
    ? (yy > nowYear ? 1900 : 2000)
    : (yy + 10 < nowYear ? 2100 : 2000);
  return `${century + yy}-${mm}-${dd}`;
}

function sanitizeDocNumber(v) {
  return (v || '').replace(/</g, '').replace(/[^A-Z0-9]/g, '').trim();
}

function sanitizeCode(v) {
  const c = (v || '').replace(/<+/g, '').replace(/[^A-Z]/g, '').trim();
  return c.length >= 3 ? c.slice(0, 3) : c;
}

function normalizeSex(v) {
  const s = String(v || '').trim().toUpperCase();
  if (s.startsWith('M')) return 'M';
  if (s.startsWith('F')) return 'F';
  return '';
}

function normalizeNationality(v) {
  const s = String(v || '').trim().toUpperCase();
  if (!s) return '';
  const map = {
    ARGENTINA: 'ARG',
    BOLIVIA: 'BOL',
    BRASIL: 'BRA',
    BRAZIL: 'BRA',
    CHILE: 'CHL',
    COLOMBIA: 'COL',
    ECUADOR: 'ECU',
    GUYANA: 'GUY',
    ESPANA: 'ESP',
    PARAGUAY: 'PRY',
    PERU: 'PER',
    ITALIA: 'ITA',
    SURINAM: 'SUR',
    SURINAME: 'SUR',
    URUGUAY: 'URY',
    VENEZUELA: 'VEN',
    UNITEDSTATES: 'USA',
    ESTADOSUNIDOS: 'USA'
  };
  if (/^[A-Z]{3}$/.test(s)) return s;
  const key = s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '');
  return map[key] || '';
}

// Nombre de programa -> código de la ficha. El código IATA de 2 o 3 letras pasa directo.
const FFN_POR_NOMBRE = [
  [/CONNECT\s*MILES|\bCOPA\b/, 'CM'],
  [/AADVANTAGE|\bAMERICAN\b/, 'AA'],
  [/LATAM/, 'LA'],
  [/AEROLINEAS PLUS|AEROLINEAS ARGENTINAS/, 'AR'],
  [/MILEAGEPLUS|\bUNITED\b/, 'UA'],
  [/\bIBERIA\b/, 'IB'],
  [/EXECUTIVE CLUB|BRITISH AIRWAYS/, 'BA'],
  [/MILES\s*&?\s*MORE|\bLUFTHANSA\b/, 'LH'],
  [/\bKLM\b/, 'KL'],
  [/FLYING BLUE|AIR FRANCE/, 'AF'],
  [/AEROPLAN|AIR CANADA/, 'AC'],
  [/CLUB PREMIER|AEROMEXICO/, 'AM'],
  [/SKYMILES|\bDELTA\b/, 'DL'],
  [/PRIVILEGE CLUB|\bQATAR\b/, 'QR'],
  [/SKYWARDS|\bEMIRATES\b/, 'EK'],
  [/LIFEMILES|\bAVIANCA\b/, 'AV'],
  [/(?<!&)\bSMILES\b|\bGOL\b/, 'G3'],
  [/AZUL FIDELIDADE|TUDO\s*AZUL|\bAZUL\b/, 'AD'],
];

export function codigoAerolineaFfn(raw) {
  const s = String(raw || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().trim();
  if (!s) return '';
  if (/^[A-Z0-9]{2,3}$/.test(s)) return s;
  const entreParentesis = s.match(/\(([A-Z0-9]{2,3})\)/);
  if (entreParentesis) return entreParentesis[1];
  const alFinal = s.match(/\b([A-Z0-9]{2})\s*$/);
  if (alFinal) return alFinal[1];
  for (const [re, code] of FFN_POR_NOMBRE) {
    if (re.test(s)) return code;
  }
  return '';
}

// Mapear resultado OCR al modelo de datos de la app
export function mapScanToForm(result) {
  const mapped = {};
  if (!result) return mapped;

  if (result.apellido) mapped.lastname = result.apellido.toUpperCase();
  if (result.nombre) mapped.firstname = result.nombre.toUpperCase();
  if (result.fecha_nacimiento) mapped.dob = result.fecha_nacimiento;
  if (result.sexo) mapped.gender = result.sexo === 'F' ? 'F' : 'M';
  if (result.nacionalidad) mapped.nationality = result.nacionalidad.toUpperCase();

  const tipo = (result.tipo || '').toUpperCase();
  const nacionalidad = normalizeNationality(result.nacionalidad || '');
  const pais = normalizeNationality(result.pais_emisor || '');

  if (tipo === 'DNI') {
    // DNI / cédula de identidad de CUALQUIER país: va a la sección DNI con su país emisor.
    // (Antes un DNI extranjero se derivaba a pasaporte porque no tenía campo de país.)
    mapped.doc_type = 'dni';
    mapped.dni = {
      country: pais || nacionalidad || 'ARG',
      num: result.numero_dni || result.numero || '',
      issue: result.fecha_emision || '',
      exp: result.fecha_vencimiento || ''
    };
  } else if (tipo === 'PASAPORTE') {
    if (pais === 'ARG' || pais === '') {
      mapped.doc_type = 'parg';
      mapped.parg = {
        num: result.numero_pasaporte || result.numero || '',
        issue: result.fecha_emision || '',
        exp: result.fecha_vencimiento || ''
      };
    } else {
      mapped.doc_type = 'pext';
      mapped.pext = {
        country: pais,
        num: result.numero_pasaporte || result.numero || '',
        issue: result.fecha_emision || '',
        exp: result.fecha_vencimiento || ''
      };
    }

    // numero_dni es el DNI argentino (ver scan-prompt: "para pasaportes ARG").
    // Solo lo seteamos en la rama parg (pais ARG o vacio). En un pasaporte
    // extranjero (pext) el "DNI" impreso (ej. el DNI espanol) NO es el DNI
    // argentino: no tiene campo propio y no debe pisar form-dni-num.
    if (result.numero_dni && (pais === 'ARG' || pais === '')) {
      mapped.dni = {
        num: result.numero_dni,
        issue: '',
        exp: ''
      };
    }
  } else if (tipo === 'VISA') {
    mapped.doc_type = 'visa';
    mapped.visa = {
      country: (result.pais_destino_visa || 'USA').toUpperCase(),
      num: result.numero || '',
      issued_at: (result.lugar_emision || '').toUpperCase(),
      type: result.tipo_visa || 'T',
      issue: result.fecha_emision || '',
      exp: result.fecha_vencimiento || '',
      passport: result.numero_pasaporte || ''
    };

    if (result.numero_pasaporte) {
      mapped.parg = {
        num: result.numero_pasaporte,
        issue: '',
        exp: ''
      };
    }
  } else if (tipo === 'ESTA') {
    mapped.doc_type = 'visa';
    mapped.visa = {
      country: 'USA',
      num: result.numero || '',
      issued_at: '',
      type: 'E',
      issue: result.fecha_emision || '',
      exp: result.fecha_vencimiento || '',
      passport: result.numero_pasaporte || ''
    };

  } else if (tipo === 'FFN' || tipo === 'VIAJERO FRECUENTE' || tipo === 'FRECUENTE') {
    // Captura de millas: solo la fila de viajero frecuente. El nombre del mail
    // no pisa la ficha (en la captura figura RODOLFO y en el perfil RODOLFO CRISTIAN).
    delete mapped.lastname;
    delete mapped.firstname;
    delete mapped.dob;
    delete mapped.gender;
    delete mapped.nationality;
    const airline = codigoAerolineaFfn(result.aerolinea || result.programa || '');
    const number = String(result.numero || result.numero_programa || '').replace(/[\s-]+/g, '');
    if (airline && number) {
      mapped.doc_type = 'ffn';
      mapped.ffn = { airline, number };
    }
  } else if (tipo === 'ASISTENCIA' || /SEGURO|ASISTENCIA MEDICA|MEDICAL ASSISTANCE|CORIS|Assist Card|Universal/i.test(result.tipo || '')) {
    // Soporte para asistencias médicas / seguros de viaje (CORIS, Assist Card, Universal, etc.)
    // El prompt instruye a Gemini a poner la compañía en "lugar_emision" y el voucher en "numero"
    mapped.doc_type = 'asistencia';
    mapped.asistencia = {
      num: result.numero || result.voucher || result.numero_pasaporte || '',
      compania: (result.lugar_emision || result.compania || result.empresa || result.proveedor || result.aseguradora || result['lugar de emisión'] || '').toUpperCase(),
      producto: result.producto || result.plan || result['producto'] || '',
      cobertura: result.cobertura || result.monto || result['cobertura hasta'] || result['cobertura'] || '',
      inicio: result.fecha_emision || result.fecha_inicio || result['fecha de inicio'] || '',
      fin: result.fecha_vencimiento || result.fecha_final || result['fecha de fin'] || '',
      duracion: ''  // will be calculated below from dates
    };

    // Calcular duración automáticamente en días a partir de las fechas de Vigencia (incluyendo ambos extremos)
    if (mapped.asistencia.inicio && mapped.asistencia.fin) {
      try {
        const start = new Date(mapped.asistencia.inicio + 'T00:00:00');
        const end = new Date(mapped.asistencia.fin + 'T00:00:00');
        if (!isNaN(start) && !isNaN(end)) {
          const diffMs = end - start;
          const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24)) + 1; // inclusivo para coincidir con "11 días" de 13 al 23
          if (diffDays > 0) {
            mapped.asistencia.duracion = diffDays.toString();
          }
        }
      } catch (e) {
        // si falla el parseo, dejar duracion vacío
      }
    }

    // También extraer datos personales si vienen en el mismo documento
    if (result.apellido) mapped.lastname = result.apellido.toUpperCase();
    if (result.nombre) mapped.firstname = result.nombre.toUpperCase();
    if (result.fecha_nacimiento) mapped.dob = result.fecha_nacimiento;
    if (result.sexo) mapped.gender = result.sexo === 'F' ? 'F' : 'M';
    if (result.nacionalidad) mapped.nationality = result.nacionalidad.toUpperCase();

  }

  return mapped;
}
