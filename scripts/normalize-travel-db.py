#!/usr/bin/env python3
# Normaliza docs/travel-db.json: clasifica la prosa de visa/sanidad en enums
# accionables para poder inyectar deterministamente (roadmap paso 2).
#
# Cobertura: columna Argentina (regionales: visa.requisito/sanidad.requisito;
# matrices: por_nacionalidad['Argentina']). Las otras 20 nacionalidades quedan
# con texto crudo hasta el paso de inyeccion nationality-aware.
#
# Clasificacion por reglas (regex sobre frases iniciales tipicas de los Excel).
# Los casos que no matchean quedan regimen 'desconocido' y se listan en
# _meta.normalizacion.residuales para revisar a mano.
# Ejecutar: python3 scripts/normalize-travel-db.py  (regenera travel-db.json)

import json
import re
import unicodedata
from pathlib import Path

DOCS = Path(__file__).resolve().parent.parent / 'docs'
SRC = DOCS / 'travel-db.json'

def _mayus_sin_acentos(texto):
    t = (texto or '').upper()
    t = unicodedata.normalize('NFD', t)
    return ''.join(c for c in t if not unicodedata.combining(c))

# Ajustes manuales verificados contra el texto del Excel (la prosa no siempre
# se deja clasificar por regex: negaciones embebidas, vias alternativas, textos
# desactualizados en una hoja y corregidos en otra).
OVERRIDES_REGIMEN = {
    # El regional aun describe la Tarjeta de Turista en papel (obsoleta); la
    # matriz y confirmacion del usuario: e-Visa 100% electronica desde 01/07/2025.
    'Cuba': 'evisa',
    # VOA de pago es el regimen; evisa.imigrasi.go.id es solo el canal online.
    'Indonesia': 'visa_on_arrival',
    # LOI + visa tramitada; la VOA de Asjabad es condicional a la LOI.
    'Turkmenistán': 'requiere_visa',
    # Lista oficial de exentos; la VOA es automatica sin tramite previo.
    'Vanuatu': 'exenta',
    # "No esta en la lista de ETA GRATUITA" (paga) dispara el guard de negacion,
    # pero el regimen si es ETA.
    'Sri Lanka': 'eta',
    # "NO esta entre los elegibles para e-visa/visa a la llegada" (forma con
    # barra) escapa al guard de on arrival: es visado consular.
    'Kuwait': 'requiere_visa',
    # "NO esta en la lista de exencion... Requiere e-visa Hayya": para ARG el
    # tramite concreto es la e-Visa Hayya, no visa consular.
    'Qatar': 'evisa',
    # "NO califica para VOA... Debe tramitar eVisa/Easy Visitor Permit": el
    # tramite para ARG es la e-Visa online.
    'Papua Nueva Guinea': 'evisa',
}

# Lookup insensible a tildes/espacios: el regional escribe "Turkmenistan" y
# la matriz "Turkmenistan" segun el archivo.
OVERRIDES_REGIMEN_NORM = {re.sub(r'[^A-Z0-9]', '', _mayus_sin_acentos(k)): v
                          for k, v in OVERRIDES_REGIMEN.items()}

# Orden de chequeo importa: na > sin_confirmar > evisa/eta > on_arrival > exenta > requiere.
def regimen_de(texto, pais=''):
    override = OVERRIDES_REGIMEN_NORM.get(re.sub(r'[^A-Z0-9]', '', _mayus_sin_acentos(pais)))
    if override:
        return override
    t = _mayus_sin_acentos(texto)
    if not t:
        return ''
    if 'N/A' in t[:20]:
        return 'na'                      # nacionalidad = pais destino
    # sin_confirmar solo si el REGIMEN no se pudo confirmar (al inicio del texto);
    # si lo que no se confirmo es un detalle (costo, duracion), el regimen vale.
    if re.search(r'NO SE PUDO (CONFIRMAR|VERIFICAR)|NO SE ENCONTRO INFORMACION|INFERIDO|SIN VERIFICAR'
                 r'|CONFLICTO ENTRE FUENTES|REPORTADO COMO|NO NOMBRADA|INCONSISTENTE|NO PUDO CONFIRMARSE', t[:200]):
        return 'sin_confirmar'
    # Variantes telegraficas: solo valen al ARRANQUE del texto. Si aparecen mas
    # tarde (Qatar: "...no confirmado con certeza" tras el regimen afirmativo;
    # Moldavia: plazo no confirmado) el regimen ya fue declarado y vale.
    if re.search(r'^(NO CONFIRMADO|SIN CONFIRMACION|PROBABLE|LISTA N2)', t[:60]):
        return 'sin_confirmar'
    # Negacion de regimenes electronicos: "NO esta entre los elegibles",
    # "NO esta en la lista de e-Visa", "NO elegible". Cualquiera de estas
    # frases invalida las ramas evisa/eta afirmativas.
    negados = [m for m in re.finditer(
        r'NO (?:ESTA(?:N)? )?(?:ENTRE|EN LA (?:LISTA|DE))|NO ELEGIBLE|NI EN LA DE|NO CALIFICA', t)]
    # "no esta en la lista GRATUITA" (ETA/VOA de pago) niega la gratuidad, no el regimen.
    negado_electronico = any(not re.search(r'GRATUIT', t[m.end():m.end() + 25]) for m in negados)
    # Australia: "NO son elegibles para eVisitor ni para ETA" -> visa comun.
    if not negado_electronico:
        # Celdas telegraficas de las matrices de Asia: arrancan directo con el
        # regimen ("e-Visa (30 dias...)", "e-Visa/VOA, ...").
        if re.match(r'^\s*E-?VISA\b', t):
            return 'evisa'
        if re.search(r'\bE-?VISA\b', t) and re.search(r'OBLIGATORI|REQUIERE|DEBE|ELEGIBLE|TRAMITE EXCLUSIVO|POR E-?VISA|VIA E-?VISA|NECESITA\s+E-?VISA', t):
            return 'evisa'
        # NOTA: ESTA (EEUU) no va como keyword: colisiona con la palabra
        # espanola "esta" ("no esta en la lista", "en esta sesion"). Para
        # argentinos el ESTA nunca aplica (fuera del VWP) -> requiere_visa.
        if (re.search(r'\b(ETA|NZETA|KETA|ETIAS)\b', t) or 'TRAVEL AUTHORI' in t) and re.search(r'OBLIGATORI|REQUIERE|DEBE|NECESITA', t) \
           and not re.search(r'\bNO ETA\b|ETA SOLO APLICA', t):
            return 'eta'
    if ('VISA ON ARRIVAL' in t or 'VISA A LA LLEGADA' in t or 'SE EMITEN A LA LLEGADA' in t or re.search(r'\bVOA\b', t)) and not re.search(
            r'(?:SIN|NI)\s+(?:VISA PREVIA\s+NI\s+)?VISA ON ARRIVAL|NO ELEGIBLE PARA (?:VISA ON ARRIVAL|VOA)'
            r'|NO HAY VISA A LA LLEGADA|NO CALIFICA PARA (?:VISA ON ARRIVAL|VOA)', t):
        return 'visa_on_arrival'
    if 'LIBRE CIRCULACION' in t:
        return 'libre_circulacion'       # intra UE/EEE
    # "NO figura en la lista de EXENCIONES" (la de paises que si requieren es
    # la lista inversa: Malasia/Singapur dicen "no figura en la lista de paises
    # que si requieren" = exenta).
    if re.search(r'NO (?:FIGURA|ESTA(?:N)?) EN LA LISTA DE EXENCION', t):
        return 'requiere_visa'
    if not re.search(r'NO EXENT|NO (?:FIGURA|ESTA(?:N)?) EN LA LISTA DE EXENCION', t) and re.search(
            r'NO REQUIEREN? VIS[AO]|NO NECESITAN? VIS[AO]|NO SE REQUIERE|NO SE EXIGE VISA|NO REQUERIRIA VISA'
            r'|EXENT[OA]S?\b|EXENCION|SIN VISA|VISA NO REQUERIDA|INGRESO CON DNI'
            r'|LISTA DE EXENCION \(ARGENTINA|NO EMITE VISAD|REGIMEN CA-4|LIBRE ACCESO', t):
        return 'exenta'
    # 'NO HOMOGENEO' sin mencion de visa/VWP = duraciones distintas pero sin visa
    # (ej. Dominica/UE: 3 vs 6 meses). Con VWP (EEUU/UE) no aplica: cae mas abajo.
    if 'NO HOMOGENEO' in t and not re.search(r'\bVWP\b|VISA', t):
        return 'exenta'
    if re.search(r'REQUIEREN? VIS[AO]|VISA OBLIGATORIA|VISA CONSULAR|VISA CONSULTADA|TRV REQUERIDO|NECESITAN? VIS[AO]|DEBE TRAMITAR(?:SE)? VISA'
            r'|VISADO REQUERIDO|VISADO OBLIGATORIO|VISA REQUERIDA|VISA (?:\w+ )?PREVIA|VISA POR ADELANTADO|TRAMITE (?:DIRECTO )?EN EMBAJADA|NO INTEGRA EL VWP|NO CALIFICA PARA (?:VISA ON ARRIVAL|VOA)\b'
            r'|^NO EXENT[OA]\b|TARJETA DE TURISTA|VISA DE TURISTA|VISA DE VISITANTE|VISITOR VISA|SUBCLASE', t):
        return 'requiere_visa'
    return 'desconocido'

_SANIDAD_NO = re.compile(
    r'\bNO EXIGID[OA]S?\b|\bNO SE EXIGE\b|\bNO ES OBLIGATORI|\bNO REQUIERE\b'
    r'|SIN REQUISITOS? SANITARIOS|SIN REQUISITO\b|SIN EXIGENCIAS|NINGUN REQUISITO'
)
_SANIDAD_EXC = re.compile(r'\bSALVO\b|\bSOLO SI\b|\bSI PROCEDE\b|\bSI LLEGA\b|\bSI HUBO\b|\bTRANSIT')
_SANIDAD_POS = re.compile(r'FIEBRE AMARILLA|CIVP|CERTIFICADO DE VACUNA|\bEXIG|\bOBLIGATORI|\bCERTIFICADO\b')
_SANIDAD_COND = re.compile(
    r'\bCONDICIONAL\b|\bSOLO SI\b|\bSOLO A\b|\bSI PROCEDE\b|\bSI HUBO\b|\bSI LLEGA\b|\bSALVO\b|\bTRANSIT'
    r'|NO CONFIRMADO|NO VERIFICADO|PROBABLEMENTE|PODRIA'
)

def sanidad_de(texto):
    # La columna de las matrices suele decir solo "EXIGIDA." / "No exigida."
    # (el certificado es el de fiebre amarilla). "EXIGIDO" no contiene "EXIGE".
    # La polaridad se decide con la primera oracion: un "no se exige" seguido
    # de una aclaracion no se vuelve condicional por un transito mas abajo.
    t = _mayus_sin_acentos(texto)
    if not t.strip():
        return ''
    if re.search(r'NACIONALIDAD\s*=\s*PAIS DESTINO', t):
        return ''
    # Seguro medico obligatorio, sin mencionar fiebre amarilla, no es el certificado.
    if 'FIEBRE AMARILLA' not in t and re.search(r'SEGURO|COBERTURA', t) and re.search(r'OBLIGATORI', t):
        return 'seguro_obligatorio'
    head = re.split(r'\.\s+', t, maxsplit=1)[0]
    # "No obligatoria" abre con la negacion. \bOBLIGATORI tambien matchea
    # adentro de esa frase y la dejaba como exigida.
    if re.match(r'\s*NO OBLIGATORI', head):
        if re.search(r'RECOMENDAD', t):
            return 'fiebre_amarilla_condicional'
        return 'sin_requisitos'
    if _SANIDAD_NO.search(head) and _SANIDAD_EXC.search(head):
        return 'fiebre_amarilla_condicional'
    if _SANIDAD_NO.search(head):
        if re.search(r'SEGURO|COBERTURA', t) and re.search(r'OBLIGATORI', t):
            return 'seguro_obligatorio'
        return 'sin_requisitos'
    scope = head if _SANIDAD_POS.search(head) else t
    if not _SANIDAD_POS.search(scope):
        if re.search(r'SEGURO|COBERTURA', t) and re.search(r'OBLIGATORI', t):
            return 'seguro_obligatorio'
        return 'otro'
    if re.search(r'\bSI EXIGIDO A TODOS\b', t):
        return 'fiebre_amarilla_obligatoria'
    if _SANIDAD_COND.search(scope):
        return 'fiebre_amarilla_condicional'
    if re.search(r'RECOMENDAD', scope) and not re.search(r'\bEXIG|\bOBLIGATORI', scope):
        return 'fiebre_amarilla_condicional'
    return 'fiebre_amarilla_obligatoria'

def duracion_de(texto):
    m = re.search(r'(?:hasta\s+)?(\d{1,3})\s*(?:\+|\s*\+\s*)(\d{1,3})?\s*d[ií]as', (texto or ''), re.I)
    if m:
        return f"{m.group(1)}+{m.group(2) or '0'} dias"
    m = re.search(r'hasta\s+(\d{1,3})\s*d[ií]as|(\d{1,3})\s*d[ií]as(?:/a[ñn]o)?', (texto or ''), re.I)
    if m:
        return (m.group(1) or m.group(2)) + ' dias'
    return ''

def main():
    db = json.loads(SRC.read_text(encoding='utf-8'))
    residuales = []

    # Regionales: argentino.
    for slug, reg in db['regiones'].items():
        for p in reg['paises']:
            p['normalizado'] = {
                'regimen': regimen_de(p['visa']['requisito'], p['pais']),
                'sanidad': sanidad_de(p['sanidad']['requisito']),
                'duracion_estadia': duracion_de(p['visa']['requisito']),
            }
            if p['normalizado']['regimen'] in ('', 'desconocido'):
                residuales.append(f"{slug}/{p['pais']}: {p['visa']['requisito'][:90]}")

    # Matrices: TODAS las nacionalidades (paso 4: inyeccion nationality-aware).
    # Los overrides manuales aplican solo a la columna Argentina.
    for slug, mm in db['matrices_multinacionalidad'].items():
        for d in mm['destinos']:
            d['normalizado'] = {}
            for nat, celda in d['por_nacionalidad'].items():
                es_arg = (nat == 'Argentina')
                d['normalizado'][nat] = {
                    'regimen': regimen_de(celda.get('visa', ''), d['pais'] if es_arg else ''),
                    'sanidad': sanidad_de(celda.get('sanidad', '')),
                    'duracion_estadia': duracion_de(celda.get('visa', '')),
                }
                if es_arg and d['normalizado'][nat]['regimen'] in ('', 'desconocido'):
                    residuales.append(f"matriz:{slug}/{d['pais']}: {celda.get('visa', '')[:90]}")
            # Compat: la columna Argentina sigue expuesta como normalizado_arg.
            arg = d['por_nacionalidad'].get('Argentina', {})
            d['normalizado_arg'] = d['normalizado'].get('Argentina', {
                'regimen': regimen_de(arg.get('visa', ''), d['pais']),
                'sanidad': sanidad_de(arg.get('sanidad', '')),
                'duracion_estadia': duracion_de(arg.get('visa', '')),
            })

    stats = {}
    for reg in db['regiones'].values():
        for p in reg['paises']:
            stats[p['normalizado']['regimen']] = stats.get(p['normalizado']['regimen'], 0) + 1
    for mm in db['matrices_multinacionalidad'].values():
        for d in mm['destinos']:
            k = 'matriz:' + d['normalizado_arg']['regimen']
            stats[k] = stats.get(k, 0) + 1

    db.setdefault('_meta', {})['normalizacion'] = {
        'regimenes': 'exenta | requiere_visa | evisa | eta | libre_circulacion | na | desconocido',
        'cobertura': 'solo columna Argentina; otras nacionalidades quedan en texto crudo',
        'stats': stats,
        'residuales': residuales,
    }

    SRC.write_text(json.dumps(db, ensure_ascii=False, indent=1), encoding='utf-8')
    print('OK ->', SRC)
    print('stats:', json.dumps(stats, ensure_ascii=False))
    print(f'residuales ({len(residuales)}):')
    for r in residuales[:25]:
        print('  -', r)

if __name__ == '__main__':
    main()
