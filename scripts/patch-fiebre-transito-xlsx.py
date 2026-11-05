#!/usr/bin/env python3
# Parche estrecho de fiebre amarilla (transito aereo). No toca el resto de las celdas.
#
# Los .xlsx de trabajo viven en docs/ y siguen gitignoreados (*.xlsx): ahi puede
# estar el original del Mac. Este script solo reemplaza celdas cuyo texto es el
# viejo o ya es el nuevo. Si no coincide, corta: no pisa un libro distinto.
#
# Copias reconstruidas (el clone no tenia los originales; se armaron desde
# docs/travel-db.json con el layout que lee excel-to-travel-db.py, y despues
# este parche): docs/fuentes-fiebre-transito/
# Esa carpeta es la unica excepcion de gitignore. No es el arbol docs/*.xlsx
# del Mac: un pull no reemplaza esos archivos ignorados.
#
# Uso, desde la raiz, con los libros ya en docs/:
#   python3 scripts/patch-fiebre-transito-xlsx.py
# Despues:
#   python3 scripts/excel-to-travel-db.py
#   python3 scripts/normalize-travel-db.py
#   node scripts/gen-matriz.mjs

import shutil
import sys
from pathlib import Path

from openpyxl import load_workbook

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / 'docs'
EXPORT = DOCS / 'fuentes-fiebre-transito'

GTM_SAN = (
    "Condicional: certificado de fiebre amarilla. "
    "No está confirmado si Guatemala lo exige al salir de Argentina. "
    "Riesgo parcial OMS: Misiones/Corrientes. No exime a Buenos Aires ni a EZE. "
    "Guatemala no publica esa excepción; Costa Rica sí exceptúa Argentina y Panamá. "
    "CDC 23 abr 2025 y OMS 3 ene 2023: desde 1 año, por país con riesgo o tránsito "
    "de aeropuerto de más de 12 horas. Sin página de MSPAS/IGM."
)
GTM_URL = "https://www.cdc.gov/yellow-book/hcp/americas-caribbean/guatemala-and-belize.html"
GTM_FUENTE = (
    "cdc.gov/yellow-book; cdn.who.int anexo 3 ene 2023. "
    "Sin pagina MSPAS/IGM vigente al 5 nov 2026."
)
CUB_ARG = (
    "Condicional: certificado de fiebre amarilla. "
    "No está confirmado si Cuba lo exige al salir de Argentina. "
    "OMS, anexo 3 ene 2023, nota 5: desde los 9 meses, si se llega de un país con riesgo "
    "o el tránsito de aeropuerto supera 12 horas. "
    "Argentina es riesgo parcial (Misiones/Corrientes); eso no exime a EZE y no hay excepción "
    "publicada para Cuba. Sin página ministerial cubana en esta revisión."
)
NO_EXIGIDA = "No exigida: certificado de fiebre amarilla. "

# (archivo, hoja 0, pais, columna o campo, viejo, nuevo)
# campo: sanidad | url | verificado | fuente | leyenda
CAMBIOS = [
    (
        "Requisitos_Visado_Sanidad_Centroamerica.xlsx",
        "Guatemala", "sanidad",
        "No se encontró fuente oficial guatemalteca que establezca exigencia de certificado de fiebre amarilla para viajeros argentinos.",
        GTM_SAN,
    ),
    (
        "Requisitos_Visado_Sanidad_Centroamerica.xlsx",
        "Guatemala", "url",
        "No encontrado / no accesible (mspas.gob.gt sin resultado)",
        GTM_URL,
    ),
    (
        "Requisitos_Visado_Sanidad_Centroamerica.xlsx",
        "Guatemala", "verificado",
        "No",
        "Parcial",
    ),
    (
        "Matriz_Visado_Sanidad_Centroamerica_Multinacionalidad.xlsx",
        "Guatemala", "Argentina",
        "No se encontro fuente oficial guatemalteca que establezca exigencia explicita para argentinos; segun clasificacion OMS de riesgo por zona (Misiones/Corrientes) podria exigirse segun itinerario.",
        GTM_SAN,
    ),
    (
        "Matriz_Visado_Sanidad_Centroamerica_Multinacionalidad.xlsx",
        "Guatemala", "UE / EEE",
        "No exigido, salvo transito por pais de riesgo.",
        "No exigida: certificado internacional de fiebre amarilla, salvo llegada desde un país con riesgo o tránsito aeroportuario de más de 12 horas.",
    ),
    (
        "Matriz_Visado_Sanidad_Centroamerica_Multinacionalidad.xlsx",
        "Guatemala", "fuente",
        "www.who.int",
        GTM_FUENTE,
    ),
]

CUB_PREFIJO = [
    ("Argentina", "Sin exigencia (Argentina no es pais de riesgo OMS).", CUB_ARG),
    ("UE / EEE", "Sin exigencia general.", None),
    ("Chile", "Sin exigencia (no es pais de riesgo).", None),
    ("Uruguay", "Sin exigencia.", None),
    ("Mexico", "Sin exigencia general.", None),
    ("Guatemala", "Sin exigencia.", None),
    ("Honduras", "Sin exigencia.", None),
    ("El Salvador", "Sin exigencia.", None),
    ("Nicaragua", "Sin exigencia.", None),
    ("Costa Rica", "Sin exigencia.", None),
    ("Belice", "Sin exigencia.", None),
    ("Estados Unidos", "Sin exigencia.", None),
    ("Canada", "Sin exigencia.", None),
]

LEYENDAS = {
    "Requisitos_Visado_Sanidad_Centroamerica.xlsx":
        "Recopilacion: 5 de noviembre de 2026. Guatemala revisada con CDC Yellow Book y OMS; sin pagina MSPAS/IGM vigente.",
    "Matriz_Visado_Sanidad_Centroamerica_Multinacionalidad.xlsx":
        "Recopilacion: 5 de noviembre de 2026. Fiebre amarilla de Guatemala: transito aeropuerto mas de 12 horas (CDC y OMS). Argentina queda sin confirmar.",
    "Matriz_Visado_Sanidad_Norteamerica_Caribe_Multinacionalidad.xlsx":
        "Recopilacion: 5 de noviembre de 2026. Cuba: transito de aeropuerto de mas de 12 horas (OMS anexo 3 ene 2023, nota 5). Argentina sin confirmar. Celdas que decian solo 'Sin exigencia' abren con No exigida.",
}

TOCADOS = [
    "Requisitos_Visado_Sanidad_Centroamerica.xlsx",
    "Matriz_Visado_Sanidad_Centroamerica_Multinacionalidad.xlsx",
    "Matriz_Visado_Sanidad_Norteamerica_Caribe_Multinacionalidad.xlsx",
]


def sanidad_de_celda(valor):
    texto = "" if valor is None else str(valor)
    if "SANIDAD:" not in texto:
        return None, texto
    visa, san = texto.split("SANIDAD:", 1)
    return visa, san.strip()


def poner_sanidad(valor, nueva):
    visa, _ = sanidad_de_celda(valor)
    if visa is None:
        return nueva
    return visa.rstrip() + "\n\nSANIDAD: " + nueva


def fila_pais(ws, pais):
    for row in ws.iter_rows(min_row=2):
        nombre = "" if row[0].value is None else str(row[0].value)
        if nombre.startswith(pais):
            return row
    raise SystemExit(f"no esta {pais} en {ws.title}")


def aplicar_regional(path, pais, campo, viejo, nuevo):
    wb = load_workbook(path)
    row = fila_pais(wb.worksheets[0], pais)
    idx = {"sanidad": 4, "url": 5, "verificado": 6}[campo]
    actual = "" if row[idx].value is None else str(row[idx].value)
    if actual == nuevo:
        wb.close()
        return "ya"
    if actual != viejo:
        raise SystemExit(f"{path.name} {pais} {campo}: texto inesperado:\n{actual[:180]}")
    row[idx].value = nuevo
    wb.save(path)
    wb.close()
    return "ok"


def aplicar_matriz(path, pais, columna, viejo, nuevo):
    wb = load_workbook(path)
    ws = wb.worksheets[0]
    headers = [c.value for c in ws[1]]
    row = fila_pais(ws, pais)
    if columna == "fuente":
        actual = "" if row[3].value is None else str(row[3].value)
        if actual == nuevo:
            wb.close()
            return "ya"
        if actual != viejo:
            raise SystemExit(f"{path.name} fuente inesperada: {actual[:180]}")
        row[3].value = nuevo
        wb.save(path)
        wb.close()
        return "ok"
    i = headers.index(columna)
    _, san = sanidad_de_celda(row[i].value)
    if san == nuevo:
        wb.close()
        return "ya"
    if san != viejo:
        raise SystemExit(f"{path.name} {pais}/{columna}: texto inesperado:\n{san[:180]}")
    row[i].value = poner_sanidad(row[i].value, nuevo)
    wb.save(path)
    wb.close()
    return "ok"


def aplicar_cuba(path):
    wb = load_workbook(path)
    ws = wb.worksheets[0]
    headers = [c.value for c in ws[1]]
    row = fila_pais(ws, "Cuba")
    cambios = 0
    for nat, viejo, nuevo in CUB_PREFIJO:
        nueva = nueva if (nueva := nuevo) is not None else NO_EXIGIDA + viejo
        i = headers.index(nat)
        _, san = sanidad_de_celda(row[i].value)
        if san == nueva:
            continue
        if san != viejo:
            raise SystemExit(f"Cuba/{nat}: texto inesperado:\n{san[:180]}")
        row[i].value = poner_sanidad(row[i].value, nueva)
        cambios += 1
    if cambios:
        wb.save(path)
    wb.close()
    return cambios


def poner_leyenda(path, texto):
    wb = load_workbook(path)
    if len(wb.worksheets) < 2:
        wb.create_sheet("Leyenda")
    ws = wb.worksheets[1]
    if ws["A1"].value == texto:
        wb.close()
        return
    ws["A1"] = texto
    wb.save(path)
    wb.close()


def main():
    faltan = [n for n in TOCADOS if not (DOCS / n).is_file()]
    if faltan:
        raise SystemExit(
            "Faltan libros en docs/: " + ", ".join(faltan)
            + ". No se recrean solos: hacen falta los 24 Excel (o las copias de docs/fuentes-fiebre-transito/)."
        )
    for archivo, pais, campo, viejo, nuevo in CAMBIOS:
        path = DOCS / archivo
        if campo in ("sanidad", "url", "verificado"):
            print(aplicar_regional(path, pais, campo, viejo, nuevo), archivo, pais, campo)
        else:
            print(aplicar_matriz(path, pais, campo, viejo, nuevo), archivo, pais, campo)
    n = aplicar_cuba(DOCS / TOCADOS[2])
    print(f"cuba celdas {n}")
    for nombre, texto in LEYENDAS.items():
        poner_leyenda(DOCS / nombre, texto)
        print("leyenda", nombre)
    EXPORT.mkdir(parents=True, exist_ok=True)
    for nombre in TOCADOS:
        dest = EXPORT / nombre
        shutil.copy2(DOCS / nombre, dest)
        print("copia", dest.relative_to(ROOT))


if __name__ == "__main__":
    sys.exit(main() or 0)
