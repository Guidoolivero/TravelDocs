#!/usr/bin/env python3
# Parche estrecho sobre los Excel ORIGINALES de fiebre amarilla.
# No recrea libros: abre el xlsx, cambia solo SANIDAD (y campos citados) y
# agrega una linea al final de la leyenda. Visado, encabezados, hojas,
# congelados, anchos y el resto de las celdas quedan iguales.
#
# Si el texto no es el viejo ni el nuevo, corta. La segunda corrida no cambia nada.
#
#   python3 scripts/patch-fiebre-transito-xlsx.py \
#     --regional /ruta/original-regional-Centroamerica.xlsx \
#     --matriz-ca /ruta/original-matrix-Centroamerica.xlsx \
#     --matriz-na /ruta/original-matrix-Norteamerica.xlsx
#
# Por defecto lee docs/fuentes-fiebre-transito/ si ya estan parcheados,
# o los uploads de esta auditoria si siguen en el entorno.
# Escribe las copias de trabajo en docs/ (gitignore) y en
# docs/fuentes-fiebre-transito/ (unica excepcion de *.xlsx).

import argparse
import shutil
import sys
from pathlib import Path

from openpyxl import load_workbook

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / 'docs'
EXPORT = DOCS / 'fuentes-fiebre-transito'
UPLOADS = Path('/home/ubuntu/.cursor/projects/workspace/uploads')

NOMBRES = {
    'regional': 'Requisitos_Visado_Sanidad_Centroamerica.xlsx',
    'matriz-ca': 'Matriz_Visado_Sanidad_Centroamerica_Multinacionalidad.xlsx',
    'matriz-na': 'Matriz_Visado_Sanidad_Norteamerica_Caribe_Multinacionalidad.xlsx',
}

CDC = 'https://www.cdc.gov/yellow-book/hcp/americas-caribbean/guatemala-and-belize.html'
OMS = 'https://cdn.who.int/media/docs/default-source/travel-and-health/countries-with-risk-of-yellow-fever-transmission.pdf'

GUA_CORTO = (
    'Condicional: certificado de fiebre amarilla. '
    'No se exige por el pasaporte ni por una llegada directa desde un país sin riesgo. '
    'Desde 1 año, sí si el itinerario trae llegada desde un país con riesgo '
    'o tránsito de aeropuerto de más de 12 horas. 12 horas o menos, sin salir del aeropuerto, no activan. '
    'CDC 23 abr 2025 y OMS 3 ene 2023, nota 5. No se encontró excepción en las fuentes consultadas.'
)
GUA_ARG = (
    'Condicional: certificado de fiebre amarilla. '
    'No está confirmado si Guatemala lo exige al salir de Argentina (EZE incluido). '
    'OMS: riesgo parcial en Misiones/Corrientes; no demuestra exención. '
    'Desde 1 año por país con riesgo o tránsito aéreo de más de 12 horas. '
    '12 horas o menos, sin salir del aeropuerto, no activan. '
    'No se encontró excepción en las fuentes consultadas. CDC 23 abr 2025; OMS nota 5.'
)
GUA_DOM = (
    'Condicional: certificado de fiebre amarilla. '
    'El pasaporte guatemalteco no es exención sanitaria. '
    'No se exige por una llegada directa desde Guatemala. '
    'Desde 1 año, sí por llegada desde un país con riesgo o tránsito aéreo de más de 12 horas. '
    '12 horas o menos, sin salir del aeropuerto, no activan. '
    'CDC 23 abr 2025; OMS nota 5. No se encontró excepción en las fuentes consultadas.'
)

def gua_riesgo(detalle):
    extra = f' Dato previo de la celda: {detalle}' if detalle else ''
    texto = (
        'Exigida: certificado de fiebre amarilla por llegada o permanencia desde este país con riesgo. '
        'También si el tránsito de aeropuerto supera 12 horas. '
        '12 horas o menos, sin salir del aeropuerto, no activan. No es regla del pasaporte. '
        'Desde 1 año. CDC 23 abr 2025; OMS 3 ene 2023, nota 5.'
        + extra
    )
    if len(texto) > 400:
        raise SystemExit(f'Guatemala riesgo pasa de 400: {len(texto)} {detalle}')
    return texto

GUA_RIESGO = {
    'Brasil': 'Brasil en lista OMS de riesgo.',
    'Paraguay': 'Paraguay en lista OMS de riesgo.',
    'Bolivia': '',
    'Colombia': '',
    'Peru': 'Zona amazonica.',
    'Venezuela': '',
    'Ecuador': 'Amazonia/Galapagos.',
    'Panama': 'Region del Darien.',
}
GUA_VIEJO = {
    'Argentina': 'No se encontro fuente oficial guatemalteca que establezca exigencia explicita para argentinos; segun clasificacion OMS de riesgo por zona (Misiones/Corrientes) podria exigirse segun itinerario.',
    'UE / EEE': 'No exigido, salvo transito por pais de riesgo.',
    'Brasil': 'Certificado EXIGIDO (Brasil en lista OMS de riesgo).',
    'Chile': 'No exigido (Chile no es pais de riesgo).',
    'Uruguay': 'No exigido.',
    'Paraguay': 'Certificado EXIGIDO (Paraguay en lista OMS de riesgo).',
    'Bolivia': 'Certificado EXIGIDO.',
    'Colombia': 'Certificado EXIGIDO.',
    'Peru': 'Certificado EXIGIDO (zona amazonica).',
    'Venezuela': 'Certificado EXIGIDO.',
    'Ecuador': 'Certificado EXIGIDO (Amazonia/Galapagos).',
    'Mexico': 'No exigido.',
    'Guatemala': 'N/A (nacionalidad = pais destino)',
    'Honduras': 'No exigido.',
    'El Salvador': 'No exigido.',
    'Nicaragua': 'No exigido.',
    'Costa Rica': 'No exigido.',
    'Panama': 'Certificado EXIGIDO (Panama en lista OMS de riesgo, region del Darien).',
    'Belice': 'No exigido.',
    'Estados Unidos': 'No exigido.',
    'Canada': 'No exigido.',
}

CUB_CORTO = (
    'Condicional: certificado de fiebre amarilla. '
    'No se exige por el pasaporte ni por una llegada directa desde un país sin riesgo. '
    'OMS 3 ene 2023, nota 5: desde los 9 meses, si hay llegada desde un país con riesgo '
    'o tránsito de aeropuerto de más de 12 horas. 12 horas o menos, sin salir del aeropuerto, no activan. '
    'Fuente antigua; no se leyó página ministerial cubana en 2026. Reconfirmar.'
)
CUB_ARG = (
    'Condicional: certificado de fiebre amarilla. '
    'No está confirmado si Cuba lo exige al salir de Argentina (EZE incluido). '
    'OMS: riesgo parcial en Misiones/Corrientes; no demuestra exención. '
    'OMS 3 ene 2023, nota 5: desde los 9 meses, por país con riesgo o tránsito aéreo de más de 12 horas. '
    '12 horas o menos, sin salir del aeropuerto, no activan. Reconfirmar; fuente antigua.'
)
CUB_RIESGO_BASE = (
    'Exigida: certificado de fiebre amarilla por llegada o permanencia desde un país con riesgo. '
    'No está confirmado con una página cubana de 2026. '
    'OMS 3 ene 2023, nota 5, desde los 9 meses. '
    'También si el tránsito de aeropuerto supera 12 horas. 12 horas o menos, sin salir del aeropuerto, no activan. '
    'No es regla del pasaporte. La nota de zona previa no se toma como regla de entrada.'
)

def cub_riesgo(previo):
    texto = CUB_RIESGO_BASE + f' Nota previa, no confirmada como regla de entrada: {previo}'
    if len(texto) > 400:
        texto = CUB_RIESGO_BASE
    if len(texto) > 400:
        raise SystemExit(f'Cuba riesgo pasa de 400: {len(texto)}')
    return texto

for _name in ('GUA_CORTO', 'GUA_ARG', 'GUA_DOM', 'CUB_CORTO', 'CUB_ARG', 'CUB_RIESGO_BASE'):
    _t = globals()[_name]
    if len(_t) > 400:
        raise SystemExit(f'{_name} > 400 ({len(_t)})')

CUB_VIEJO = {
    'Argentina': 'Sin exigencia (Argentina no es pais de riesgo OMS).',
    'UE / EEE': 'Sin exigencia general.',
    'Brasil': 'Brasil tiene zonas de riesgo (Amazonia/algunos estados); llevar certificado si procede de esas zonas.',
    'Chile': 'Sin exigencia (no es pais de riesgo).',
    'Uruguay': 'Sin exigencia.',
    'Paraguay': 'Paraguay tiene zonas de riesgo (este del pais); recomendable certificado.',
    'Bolivia': 'Bolivia tiene zonas de riesgo (tierras bajas/Amazonia); recomendable/exigible segun procedencia.',
    'Colombia': 'Colombia tiene zonas de riesgo; recomendable certificado.',
    'Peru': 'Peru tiene zonas de riesgo (selva); recomendable segun procedencia.',
    'Venezuela': 'Venezuela tiene zonas de riesgo; recomendable certificado segun procedencia.',
    'Ecuador': 'Zonas de riesgo (Amazonia); recomendable.',
    'Mexico': 'Sin exigencia general.',
    'Guatemala': 'Sin exigencia.',
    'Honduras': 'Sin exigencia.',
    'El Salvador': 'Sin exigencia.',
    'Nicaragua': 'Sin exigencia.',
    'Costa Rica': 'Sin exigencia.',
    'Panama': 'Zona del Darien es de riesgo; recomendable segun procedencia.',
    'Belice': 'Sin exigencia.',
    'Estados Unidos': 'Sin exigencia.',
    'Canada': 'Sin exigencia.',
}

NOTA_GUA = (
    ' Revision 5 nov 2026 (fiebre amarilla): desde 1 año, por llegada desde un país con riesgo '
    'o tránsito de aeropuerto de más de 12 horas (CDC Yellow Book 23 abr 2025; OMS anexo 3 ene 2023, nota 5). '
    '12 horas o menos sin salir del aeropuerto no activan. No se encontró excepción para la salida desde EZE.'
)
NOTA_CUB = (
    ' Revision 5 nov 2026 (fiebre amarilla): regla provisional OMS 3 ene 2023, nota 5, desde los 9 meses, '
    'por llegada desde un país con riesgo o tránsito de aeropuerto de más de 12 horas. '
    'No se leyó página ministerial cubana. No se encontró excepción para la salida desde EZE.'
)
NOTA_REG = (
    ' Revision 5 nov 2026: fiebre amarilla de Guatemala queda condicional al itinerario '
    '(CDC 23 abr 2025 y OMS 3 ene 2023, nota 5; más de 12 horas, no 12 exactas). '
    'Salida desde EZE sin excepción confirmada. Verificado sanitario: Parcial.'
)


def sanidad(valor):
    texto = '' if valor is None else str(valor)
    if 'SANIDAD:' not in texto:
        return None, texto
    visa, san = texto.split('SANIDAD:', 1)
    return visa, san.strip()


def poner(cell, nueva):
    visa, _ = sanidad(cell.value)
    if visa is None:
        cell.value = nueva
        return
    if not visa.endswith('SANIDAD:'):
        # El original separa con "\n\nSANIDAD:".
        if '\n\nSANIDAD:' in str(cell.value):
            pref = str(cell.value).split('\n\nSANIDAD:', 1)[0]
            cell.value = pref + '\n\nSANIDAD: ' + nueva
            return
    cell.value = visa + 'SANIDAD: ' + nueva


def fila(ws, pais):
    for row in ws.iter_rows(min_row=2):
        nombre = '' if row[0].value is None else str(row[0].value)
        if nombre.startswith(pais):
            return row
    raise SystemExit(f'no esta {pais}')


def aplicar_mapa(ws, pais, viejos, nuevos):
    row = fila(ws, pais)
    headers = [c.value for c in ws[1]]
    n = 0
    for nat, nuevo in nuevos.items():
        i = headers.index(nat)
        _, san = sanidad(row[i].value)
        if san == nuevo:
            continue
        if san != viejos[nat]:
            raise SystemExit(f'{pais}/{nat}: texto inesperado:\n{san[:220]}')
        poner(row[i], nuevo)
        n += 1
    return n


def anexar_nota(cell, extra):
    actual = '' if cell.value is None else str(cell.value)
    if extra.strip() in actual:
        return 0
    cell.value = actual.rstrip() + extra
    return 1


def anexar_leyenda(ws, linea):
    if ws['A1'].value and not str(ws['A1'].value).lower().startswith('c'):
        # "Cómo usar" / "Como usar". No se toca A1.
        pass
    for row in ws.iter_rows():
        for c in row:
            if c.value and linea.strip() in str(c.value):
                return 0
    destino = ws.max_row + 2
    ws.cell(destino, 1).value = linea.strip()
    return 1


def mapa_guatemala():
    out = {}
    for nat, viejo in GUA_VIEJO.items():
        if nat == 'Argentina':
            out[nat] = GUA_ARG
        elif nat == 'Guatemala':
            out[nat] = GUA_DOM
        elif nat in GUA_RIESGO:
            out[nat] = gua_riesgo(GUA_RIESGO[nat])
        else:
            out[nat] = GUA_CORTO
        if len(out[nat]) > 400:
            raise SystemExit(f'{nat} {len(out[nat])}')
    return out


def mapa_cuba():
    riesgo = {'Brasil', 'Paraguay', 'Bolivia', 'Colombia', 'Peru', 'Venezuela', 'Ecuador', 'Panama'}
    out = {}
    for nat in CUB_VIEJO:
        if nat == 'Argentina':
            out[nat] = CUB_ARG
        elif nat in riesgo:
            out[nat] = cub_riesgo(CUB_VIEJO[nat])
        else:
            out[nat] = CUB_CORTO
        if len(out[nat]) > 400:
            raise SystemExit(f'CUB {nat} {len(out[nat])}')
    return out


def patch_regional(path):
    wb = load_workbook(path)
    if wb.sheetnames != ['Centroamerica', 'Leyenda y notas']:
        raise SystemExit(f'hojas regionales inesperadas: {wb.sheetnames}')
    ws = wb.worksheets[0]
    if ws.freeze_panes != 'A2':
        raise SystemExit('se perdio el congelado del regional')
    row = fila(ws, 'Guatemala')
    header = [c.value for c in ws[1]]
    esperado = ['País', 'Visado - Requisito (ciudadano argentino)', 'Visado - Link oficial',
                'Visado - Verificado', 'Sanidad - Requisito', 'Sanidad - Link oficial',
                'Sanidad - Verificado', 'Notas / Advertencias']
    if header != esperado:
        raise SystemExit(f'encabezado regional inesperado: {header}')
    visa_antes = row[1].value
    san = '' if row[4].value is None else str(row[4].value)
    viejo = 'No se encontró fuente oficial guatemalteca que establezca exigencia de certificado de fiebre amarilla para viajeros argentinos.'
    if san not in (viejo, GUA_ARG):
        raise SystemExit(f'sanidad regional inesperada: {san[:180]}')
    if san != GUA_ARG:
        row[4].value = GUA_ARG
    url = '' if row[5].value is None else str(row[5].value)
    url_vieja = 'No encontrado / no accesible (mspas.gob.gt sin resultado)'
    if url == url_vieja:
        row[5].value = CDC
    elif url != CDC:
        raise SystemExit(f'url regional inesperada: {url[:180]}')
    ver = '' if row[6].value is None else str(row[6].value)
    if ver == 'No':
        row[6].value = 'Parcial'
    elif ver != 'Parcial':
        raise SystemExit(f'verificado regional inesperado: {ver}')
    if row[1].value != visa_antes:
        raise SystemExit('se toco el visado regional')
    anexar_nota(row[7], NOTA_REG)
    if not str(wb.worksheets[1]['A1'].value).startswith('Cómo usar'):
        raise SystemExit('leyenda regional A1 alterada')
    anexar_leyenda(wb.worksheets[1], NOTA_REG.strip())
    wb.save(path)
    wb.close()


def snapshot_usa(path):
    wb = load_workbook(path)
    ws = wb.worksheets[0]
    row = fila(ws, 'Estados Unidos')
    vals = tuple(c.value for c in row[:27])
    ley = wb.worksheets[1]['A28'].value
    wb.close()
    return vals, ley


def patch_matriz(path, pais, viejos, nuevos, nota, fuente_extra=None):
    usa_antes = snapshot_usa(path) if pais == 'Cuba' else None
    wb = load_workbook(path)
    ws = wb.worksheets[0]
    if ws.freeze_panes != 'F2':
        raise SystemExit(f'{path.name}: congelado {ws.freeze_panes}')
    headers = [c.value for c in ws[1]]
    if headers[0] != 'Pais destino' or not str(headers[-1]).startswith('Notas'):
        raise SystemExit(f'encabezados inesperados: {headers[:5]} ... {headers[-1]}')
    if len(headers) != 27:
        raise SystemExit('la matriz no tiene 27 columnas')
    n = aplicar_mapa(ws, pais, viejos, nuevos)
    row = fila(ws, pais)
    if fuente_extra:
        actual = '' if row[3].value is None else str(row[3].value)
        if fuente_extra not in actual:
            row[3].value = actual.rstrip() + fuente_extra
    notas_i = 26
    anexar_nota(row[notas_i], nota)
    if not str(wb.worksheets[1]['A1'].value).lower().startswith('como usar'):
        raise SystemExit('leyenda A1 alterada')
    anexar_leyenda(wb.worksheets[1], nota.strip())
    wb.save(path)
    wb.close()
    if usa_antes:
        despues, ley = snapshot_usa(path)
        if despues != usa_antes[0] or ley != usa_antes[1]:
            raise SystemExit('cambio la fila Estados Unidos o la leyenda del 2 nov 2026')
    return n


def destino_de(arg, nombre, fallbacks):
    if arg:
        return Path(arg)
    for p in fallbacks:
        if p.is_file():
            return p
    raise SystemExit(f'falta el original de {nombre}')


def publicar(src, nombre):
    EXPORT.mkdir(parents=True, exist_ok=True)
    tracked = EXPORT / nombre
    work = DOCS / nombre
    shutil.copy2(src, tracked)
    shutil.copy2(src, work)
    print(nombre, tracked)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--regional')
    ap.add_argument('--matriz-ca')
    ap.add_argument('--matriz-na')
    args = ap.parse_args()
    regional = destino_de(args.regional, 'regional', [
        UPLOADS / 'original-regional-Centroamerica_e4a5.xlsx',
        EXPORT / NOMBRES['regional'],
        DOCS / NOMBRES['regional'],
    ])
    matriz_ca = destino_de(args.matriz_ca, 'matriz CA', [
        UPLOADS / 'original-matrix-Centroamerica_a506.xlsx',
        EXPORT / NOMBRES['matriz-ca'],
        DOCS / NOMBRES['matriz-ca'],
    ])
    matriz_na = destino_de(args.matriz_na, 'matriz NA', [
        UPLOADS / 'original-matrix-Norteamerica_07e4.xlsx',
        EXPORT / NOMBRES['matriz-na'],
        DOCS / NOMBRES['matriz-na'],
    ])
    # Se trabaja sobre copia, nunca sobre el upload.
    tmp = ROOT / 'tmp-yf-originales'
    tmp.mkdir(exist_ok=True)
    copias = {}
    for key, src in (('regional', regional), ('matriz-ca', matriz_ca), ('matriz-na', matriz_na)):
        dest = tmp / NOMBRES[key]
        shutil.copy2(src, dest)
        copias[key] = dest
    patch_regional(copias['regional'])
    fu_gua = (
        ' Revisado 5 nov 2026: ' + CDC + ' (Yellow Book, 23 abr 2025) y ' + OMS
        + ' (anexo 18 nov 2022, revisado 3 ene 2023, nota 5). Sin pagina MSPAS/IGM. Sigue Parcial.'
    )
    fu_cub = (
        ' Revisado 5 nov 2026: ' + OMS
        + ' (anexo 18 nov 2022, revisado 3 ene 2023; Cuba nota 5, desde los 9 meses, transito de mas de 12 horas). '
        'No se leyo pagina ministerial cubana. Sigue Parcial. Se conserva www.cives.ufrj.br.'
    )
    n1 = patch_matriz(copias['matriz-ca'], 'Guatemala', GUA_VIEJO, mapa_guatemala(), NOTA_GUA, fu_gua)
    n2 = patch_matriz(copias['matriz-na'], 'Cuba', CUB_VIEJO, mapa_cuba(), NOTA_CUB, fu_cub)
    print(f'guatemala celdas {n1}; cuba celdas {n2}')
    for key in copias:
        publicar(copias[key], NOMBRES[key])
    return 0


if __name__ == '__main__':
    sys.exit(main())
