#!/usr/bin/env python3
# Consolida los 14 Excel de requisitos (10 regionales + 4 matrices multinacionalidad)
# en un unico JSON: docs/travel-db.json.
#
# Estructura de entrada:
# - Regionales: 1 hoja de datos con columnas [Pais, Visado-Requisito, Visado-Link,
#   Visado-Verificado, Sanidad-Requisito, Sanidad-Link, Sanidad-Verificado, Notas]
#   + hojas de leyenda (1 columna, se ignoran salvo la fecha de recopilacion).
# - Matrices: filas = pais destino, columnas F.. = 21 nacionalidades. Cada celda es
#   prosa "VISADO: ...\n\nSANIDAD: ..." que se separa en dos campos.
#
# El JSON es fiel al Excel (texto verbatim); la normalizacion a enums accionables
# (categoria, costo, anticipacion) es un paso posterior, no aca.
# Ejecutar: python3 scripts/excel-to-travel-db.py  (desde la raiz de DocTravel)

import json
import re
import unicodedata
from pathlib import Path

import openpyxl

DOCS = Path(__file__).resolve().parent.parent / 'docs'
OUT = DOCS / 'travel-db.json'

# (slug de region, archivo regional, archivo matriz o None)
REGIONES = [
    ('america_del_sur',              'Requisitos_Visado_Sanidad_America_del_Sur.xlsx', None),
    ('centroamerica',                'Requisitos_Visado_Sanidad_Centroamerica.xlsx',
                                     'Matriz_Visado_Sanidad_Centroamerica_Multinacionalidad.xlsx'),
    ('norteamerica_caribe',          'Requisitos_Visado_Sanidad_Norteamerica_Caribe.xlsx',
                                     'Matriz_Visado_Sanidad_Norteamerica_Caribe_Multinacionalidad.xlsx'),
    ('europa_occidental_nordica',    'Requisitos_Visado_Sanidad_Europa_Occidental_Nordica.xlsx',
                                     'Matriz_Visado_Sanidad_Europa_Occidental_Nordica_Multinacionalidad.xlsx'),
    ('europa_central_este_balcanes', 'Requisitos_Visado_Sanidad_Europa_Central_Este_Balcanes.xlsx',
                                     'Matriz_Visado_Sanidad_Europa_Central_Este_Balcanes_Multinacionalidad.xlsx'),
    ('asia_meridional_mediooriente', 'Requisitos_Visado_Sanidad_Asia_Meridional_MedioOriente.xlsx',
                                     'Matriz_Visado_Sanidad_Asia_Meridional_MedioOriente_Multinacionalidad.xlsx'),
    ('asia_oriental_sudeste',        'Requisitos_Visado_Sanidad_Asia_Oriental_Sudeste.xlsx',
                                     'Matriz_Visado_Sanidad_Asia_Oriental_Sudeste_Multinacionalidad.xlsx'),
    ('asia_central_caucaso',         'Requisitos_Visado_Sanidad_Asia_Central_Caucaso.xlsx',
                                     'Matriz_Visado_Sanidad_Asia_Central_Caucaso_Multinacionalidad.xlsx'),
    ('oceania',                      'Requisitos_Visado_Sanidad_Oceania.xlsx',
                                     'Matriz_Visado_Sanidad_Oceania_Multinacionalidad.xlsx'),
    ('africa_norte',                 'Requisitos_Visado_Sanidad_Africa_Norte.xlsx',
                                     'Matriz_Visado_Sanidad_Africa_Norte_Multinacionalidad.xlsx'),
    # Africa subsahariana: solo matrices (sin regional por pais).
    ('africa_occidental',            None, 'Matriz_Visado_Sanidad_Africa_Occidental_Multinacionalidad.xlsx'),
    ('africa_central',               None, 'Matriz_Visado_Sanidad_Africa_Central_Multinacionalidad.xlsx'),
    ('africa_oriental',              None, 'Matriz_Visado_Sanidad_Africa_Oriental_Multinacionalidad.xlsx'),
    ('africa_austral',               None, 'Matriz_Visado_Sanidad_Africa_Austral_Multinacionalidad.xlsx'),
    # La matriz de Sudamerica va en su propia region (no tiene regional aparte en la lista).
]

# Matriz de Sudamerica: la manejamos como region propia porque los regionales
# de America del Sur no tienen matriz asociada en el mismo grupo de columnas.
MATRIZ_SUDAMERICA = ('sudamerica_matriz', 'Matriz_Visado_Sanidad_Sudamerica_Multinacionalidad.xlsx')

def norm(s):
    """MAYUS, sin acentos, solo alfanumericos. Para matchear nombres de pais."""
    s = (s or '').upper()
    s = unicodedata.normalize('NFD', s)
    s = ''.join(c for c in s if not unicodedata.combining(c))
    return re.sub(r'[^A-Z0-9]', '', s)

# nombre normalizado -> ISO3. Incompleto a proposito: los que faltan quedan en
# _meta.pendientes_iso3 para completar a mano (no adivinamos).
ISO3 = {
    # America
    'ARGENTINA': 'ARG', 'BOLIVIA': 'BOL', 'BRASIL': 'BRA', 'CHILE': 'CHL',
    'URUGUAY': 'URY', 'PARAGUAY': 'PRY', 'PERU': 'PER', 'COLOMBIA': 'COL',
    'ECUADOR': 'ECU', 'VENEZUELA': 'VEN', 'GUYANA': 'GUY', 'SURINAM': 'SUR',
    'EEUU': 'USA', 'ESTADOSUNIDOS': 'USA', 'CANADA': 'CAN', 'MEXICO': 'MEX',
    'CUBA': 'CUB', 'REPUBLICADOMINICANA': 'DOM', 'BAHAMAS': 'BHS',
    'JAMAICA': 'JAM', 'BARBADOS': 'BRB', 'TRINIDADYTOBAGO': 'TTO',
    'SANTALUCIA': 'LCA', 'GRANADA': 'GRD', 'SANVICENTEYLASGRANADINAS': 'VCT',
    'ANTIGUAYBARBUDA': 'ATG', 'DOMINICA': 'DMA', 'SANCRISTOBALYNIEVES': 'KNA',
    'SANCRISTOBALYNEVES': 'KNA', 'GUATEMALA': 'GTM', 'HONDURAS': 'HND',
    'ELSALVADOR': 'SLV', 'NICARAGUA': 'NIC', 'COSTARICA': 'CRI', 'PANAMA': 'PAN',
    'BELICE': 'BLZ', 'HAITI': 'HTI', 'ARUBA': 'ABW',
    # Europa
    'ESPANA': 'ESP', 'ITALIA': 'ITA', 'FRANCIA': 'FRA', 'ALEMANIA': 'DEU',
    'PORTUGAL': 'PRT', 'PAISESBAJOS': 'NLD', 'GRECIA': 'GRC', 'BELGICA': 'BEL',
    'SUIZA': 'CHE', 'AUSTRIA': 'AUT', 'ISLANDIA': 'ISL', 'NORUEGA': 'NOR',
    'DINAMARCA': 'DNK', 'SUECIA': 'SWE', 'FINLANDIA': 'FIN',
    'REINOUNIDO': 'GBR', 'IRLANDA': 'IRL', 'ANDORRA': 'AND', 'MONACO': 'MCO',
    'POLONIA': 'POL', 'REPUBLICACHECA': 'CZE', 'ESLOVAQUIA': 'SVK',
    'HUNGRIA': 'HUN', 'ESLOVENIA': 'SVN', 'CROACIA': 'HRV', 'BULGARIA': 'BGR',
    'RUMANIA': 'ROU', 'MALTA': 'MLT', 'CHIPRE': 'CYP', 'ESTONIA': 'EST',
    'LETÓNIA': 'LVA', 'LETONIA': 'LVA', 'LITUANIA': 'LTU',
    'LIECHTENSTEIN': 'LIE', 'SANMARINO': 'SMR', 'CIUDADDELVATICANO': 'VAT',
    'VATICANO': 'VAT', 'ALBANIA': 'ALB', 'BOSNIAYHERZEGOVINA': 'BIH',
    'MONTENEGRO': 'MNE', 'MACEDONIADELNORTE': 'MKD', 'SERBIA': 'SRB',
    'KOSOVO': 'XKX', 'UCRANIA': 'UKR', 'MOLDAVIA': 'MDA', 'BIELORRUSIA': 'BLR',
    # Asia occidental / Medio Oriente
    'TURQUIA': 'TUR', 'GEORGIA': 'GEO', 'ARMENIA': 'ARM', 'AZERBAIYAN': 'AZE',
    'AZERBAIJAN': 'AZE', 'KAZAJISTAN': 'KAZ', 'UZBEKISTAN': 'UZB',
    'TURKMENISTAN': 'TKM', 'KIRGUISTAN': 'KGZ', 'TAYIKISTAN': 'TJK',
    'INDIA': 'IND', 'PAKISTAN': 'PAK', 'BANGLADESH': 'BGD', 'SRILANKA': 'LKA',
    'NEPAL': 'NPL', 'BUTAN': 'BTN', 'MALDIVAS': 'MDV', 'AFGANISTAN': 'AFG',
    'IRAN': 'IRN', 'IRAQ': 'IRQ', 'IRAK': 'IRQ', 'SIRIA': 'SYR', 'LIBANO': 'LBN',
    'ISRAEL': 'ISR', 'JORDANIA': 'JOR', 'ARABIASAUDITA': 'SAU', 'QATAR': 'QAT',
    'KUWAIT': 'KWT', 'BAHREIN': 'BHR', 'EMIRATOSARABESUNIDOS': 'ARE',
    'OMAN': 'OMN', 'YEMEN': 'YEM',
    # Asia oriental / sudeste
    'CHINA': 'CHN', 'JAPON': 'JPN', 'COREADELSUR': 'KOR', 'COREADELNORTE': 'PRK',
    'MONGOLIA': 'MNG', 'TAIWAN': 'TWN', 'HONGKONG': 'HKG', 'MACAO': 'MAC',
    'VIETNAM': 'VNM', 'LAOS': 'LAO', 'CAMBOYA': 'KHM', 'TAILANDIA': 'THA',
    'MYANMAR': 'MMR', 'BIRMANIA': 'MMR', 'MALASIA': 'MYS', 'SINGAPUR': 'SGP',
    'INDONESIA': 'IDN', 'FILIPINAS': 'PHL', 'BRUNEI': 'BRN', 'TIMORORIENTAL': 'TLS',
    # Oceania
    'AUSTRALIA': 'AUS', 'NUEVAZELANDIA': 'NZL', 'NUEVAZELANDA': 'NZL', 'FIJI': 'FJI',
    'PAPUANUEVAGUINEA': 'PNG', 'TONGA': 'TON', 'VANUATU': 'VUT',
    'ISLASSALOMON': 'SLB', 'PALAOS': 'PLW', 'ISLASMARSHALL': 'MHL',
    'NAURU': 'NRU', 'KIRIBATI': 'KIR', 'TUVALU': 'TUV', 'SAMOA': 'WSM',
    'MICRONESIA': 'FSM', 'ISLASCOOK': 'COK', 'NIUE': 'NIU',
    # Africa norte
    'EGIPTO': 'EGY', 'MARRUECOS': 'MAR', 'TUNEZ': 'TUN', 'ARGELIA': 'DZA',
    'LIBIA': 'LBY',
    # Africa subsahariana
    'ANGOLA': 'AGO', 'BENIN': 'BEN', 'BOTSWANA': 'BWA', 'BOTSUANA': 'BWA', 'BURKINAFASO': 'BFA',
    'BURUNDI': 'BDI', 'CABOVERDE': 'CPV', 'CAMERUN': 'CMR', 'CHAD': 'TCD',
    'COMORAS': 'COM', 'COSTADEMARFIL': 'CIV', 'ERITREA': 'ERI', 'ESUATINI': 'SWZ',
    'ETIOPIA': 'ETH', 'GABON': 'GAB', 'GAMBIA': 'GMB', 'GHANA': 'GHA',
    'GUINEA': 'GIN', 'GUINEAECUATORIAL': 'GNQ', 'GUINEABISAU': 'GNB',
    'KENIA': 'KEN', 'LESOTO': 'LSO', 'LIBERIA': 'LBR', 'MADAGASCAR': 'MDG',
    'MALAUI': 'MWI', 'MALI': 'MLI', 'MAURICIO': 'MUS', 'MAURITANIA': 'MRT',
    'MOZAMBIQUE': 'MOZ', 'NAMIBIA': 'NAM', 'NIGER': 'NER', 'NIGERIA': 'NGA',
    'REPUBLICACENTROAFRICANA': 'CAF', 'REPUBLICADEMOCRATICADELCONGO': 'COD',
    'REPUBLICADELCONGO': 'COG', 'RUANDA': 'RWA', 'SANTOTOMEYPRINCIPE': 'STP',
    'SENEGAL': 'SEN', 'SEYCHELLES': 'SYC', 'SIERRALEONA': 'SLE', 'SOMALIA': 'SOM',
    'SUDAFRICA': 'ZAF', 'SUDAN': 'SDN', 'SUDANDELSUR': 'SSD', 'TANZANIA': 'TZA',
    'TOGO': 'TGO', 'UGANDA': 'UGA', 'YIBUTI': 'DJI', 'ZAMBIA': 'ZMB',
    'ZIMBABUE': 'ZWE',
}

def nombre_limpio(nombre):
    """Saca sufijos de advertencia y parentesis: 'Bielorrusia  ⚠ ALERTA...' -> 'Bielorrusia'."""
    t = (nombre or '').strip()
    t = re.split(r'⚠', t)[0].strip()            # sufijo de alerta de viaje
    t = re.sub(r'\s*\([^)]*\)\s*$', '', t).strip()  # sufijo entre parentesis final
    return t

def iso3_de(nombre):
    n = norm(nombre_limpio(nombre))
    if not n:
        return ''
    if n in ISO3:
        return ISO3[n]
    # Fallback por prefijo: 'Micronesia (Estados Federados de)' ya normalizado
    # como 'MICRONESIAESTADOSFEDERADOSDE' matchea la clave 'MICRONESIA'.
    candidatos = [k for k in ISO3 if n.startswith(k)]
    if candidatos:
        return ISO3[max(candidatos, key=len)]
    return ''

def tiene_alerta_viaje(nombre):
    return '⚠' in (nombre or '')

def confianza_de(texto):
    """Normaliza el texto libre de 'Verificado' a un enum: si | parcial | no."""
    t = norm(texto)
    if not t:
        return ''
    if t.startswith('SI'):
        return 'si'
    if t.startswith('PARCIAL'):
        return 'parcial'
    if t.startswith('NO'):
        return 'no'
    return 'otro'

def txt(c):
    return (str(c).strip() if c is not None else '')

def split_visado_sanidad(celda):
    """Separa la prosa de matriz 'VISADO: ...\\n\\nSANIDAD: ...' en dos campos."""
    texto = txt(celda)
    if not texto:
        return '', ''
    m = re.search(r'SANIDAD\s*:', texto)
    if not m:
        # Algunas celdas arrancan directo con el regimen (sin prefijo VISADO).
        visa = re.sub(r'^VISADO\s*:\s*', '', texto).strip()
        return visa, ''
    visa = texto[:m.start()].strip()
    visa = re.sub(r'^VISADO\s*:\s*', '', visa).strip()
    sanidad = re.sub(r'^SANIDAD\s*:\s*', '', texto[m.start():]).strip()
    return visa, sanidad

def parse_regional(archivo):
    """Hoja de datos del regional -> lista de paises con visa/sanidad para ARG."""
    wb = openpyxl.load_workbook(DOCS / archivo, read_only=True, data_only=True)
    ws = wb.worksheets[0]  # la hoja de datos es la primera
    filas = list(ws.iter_rows(values_only=True))
    header = [txt(c) for c in filas[0]]
    idx = {nombre: i for i, nombre in enumerate(header)}
    paises = []
    for row in filas[1:]:
        pais = txt(row[idx.get('País', 0)])
        if not pais:
            continue
        paises.append({
            'pais': nombre_limpio(pais),
            'alerta_viaje': tiene_alerta_viaje(pais),
            'iso3': iso3_de(pais),
            'visa': {
                'requisito': txt(row[idx['Visado - Requisito (ciudadano argentino)']]),
                'url_oficial': txt(row[idx['Visado - Link oficial']]),
                'verificado': txt(row[idx['Visado - Verificado']]),
                'confianza': confianza_de(row[idx['Visado - Verificado']]),
            },
            'sanidad': {
                'requisito': txt(row[idx['Sanidad - Requisito']]),
                'url_oficial': txt(row[idx['Sanidad - Link oficial']]),
                'verificado': txt(row[idx['Sanidad - Verificado']]),
                'confianza': confianza_de(row[idx['Sanidad - Verificado']]),
            },
            'notas': txt(row[idx.get('Notas / Advertencias', len(header) - 1)]),
        })
    # Fecha de recopilacion desde las hojas de leyenda (texto libre, 1 columna).
    fecha = ''
    for ws2 in wb.worksheets[1:]:
        for row in ws2.iter_rows(values_only=True):
            t = txt(row[0]) if row else ''
            m = re.search(r'(\d{1,2}\s+de\s+\w+\s+de\s+20\d\d|\d{2}/\d{2}/20\d\d)', t, re.I)
            if m:
                fecha = m.group(1)
                break
        if fecha:
            break
    return paises, fecha

def parse_matriz(archivo):
    """Matriz multinacionalidad -> destinos con regimen por nacionalidad."""
    wb = openpyxl.load_workbook(DOCS / archivo, read_only=True, data_only=True)
    ws = wb.worksheets[0]
    filas = list(ws.iter_rows(values_only=True))
    header = [txt(c) for c in filas[0]]
    try:
        i_notas = next(i for i, h in enumerate(header) if h.startswith('Notas'))
    except StopIteration:
        i_notas = len(header)
    # Nacionalidades: entre las 4 columnas de fuente/verificado y Notas.
    nats = [(h, i) for i, h in enumerate(header) if 5 <= i < i_notas and h]
    destinos = []
    for row in filas[1:]:
        pais = txt(row[0])
        if not pais:
            continue
        por_nat = {}
        for nombre_nat, i in nats:
            visa, sanidad = split_visado_sanidad(row[i])
            if not visa and not sanidad:
                continue
            por_nat[nombre_nat] = {'visa': visa, 'sanidad': sanidad}
        destinos.append({
            'pais': nombre_limpio(pais),
            'alerta_viaje': tiene_alerta_viaje(pais),
            'iso3': iso3_de(pais),
            'fuente_visado': txt(row[1]),
            'verificado_visado': txt(row[2]),
            'confianza_visado': confianza_de(row[2]),
            'fuente_sanidad': txt(row[3]),
            'verificado_sanidad': txt(row[4]),
            'confianza_sanidad': confianza_de(row[4]),
            'notas': txt(row[i_notas]) if i_notas < len(row) else '',
            'por_nacionalidad': por_nat,
        })
    return {
        'nacionalidades': [n for n, _ in nats],
        'destinos': destinos,
    }

def main():
    db = {
        '_meta': {
            'descripcion': 'Base de requisitos de visado y sanidad consolidada desde los Excel verificados.',
            'generado_por': 'scripts/excel-to-travel-db.py',
            'texto': 'Verbatim de los Excel; la normalizacion a campos accionables (categoria/costo/anticipacion) es un paso posterior.',
            'confianza': 'si | parcial | no (normalizado de la columna Verificado); las celdas con "reconfirmar" en el texto deben tratarse como requiere-verificacion-web.',
            'fuentes': [],
        },
        'regiones': {},
        'matrices_multinacionalidad': {},
    }
    pendientes_iso3 = set()

    for slug, regional, matriz in REGIONES:
        if regional:
            paises, fecha = parse_regional(regional)
            db['_meta']['fuentes'].append(regional)
            for p in paises:
                if not p['iso3']:
                    pendientes_iso3.add(p['pais'])
            db['regiones'][slug] = {
                'archivo': regional,
                'fecha_recopilacion': fecha,
                'paises': paises,
            }
        if matriz:
            db['_meta']['fuentes'].append(matriz)
            m = parse_matriz(matriz)
            for d in m['destinos']:
                if not d['iso3']:
                    pendientes_iso3.add(d['pais'])
            db['matrices_multinacionalidad'][slug] = {'archivo': matriz, **m}

    # Matriz de Sudamerica (region propia).
    slug, archivo = MATRIZ_SUDAMERICA
    db['_meta']['fuentes'].append(archivo)
    m = parse_matriz(archivo)
    for d in m['destinos']:
        if not d['iso3']:
            pendientes_iso3.add(d['pais'])
    db['matrices_multinacionalidad'][slug] = {'archivo': archivo, **m}

    db['_meta']['pendientes_iso3'] = sorted(pendientes_iso3)

    OUT.write_text(json.dumps(db, ensure_ascii=False, indent=1), encoding='utf-8')

    # Resumen por stderr para el operador.
    total_reg = sum(len(r['paises']) for r in db['regiones'].values())
    total_mat = sum(len(r['destinos']) for r in db['matrices_multinacionalidad'].values())
    nats = sorted({n for r in db['matrices_multinacionalidad'].values() for n in r['nacionalidades']})
    print(f'OK -> {OUT}')
    print(f'  regionales: {len(db["regiones"])} archivos, {total_reg} paises')
    print(f'  matrices:   {len(db["matrices_multinacionalidad"])} archivos, {total_mat} destinos, {len(nats)} nacionalidades')
    print(f'  pendientes_iso3: {len(pendientes_iso3)} -> {", ".join(sorted(pendientes_iso3)) or "ninguno"}')

if __name__ == '__main__':
    main()
