# Reemplaza 6 recuadros del Formulario TSP con la realidad de TravelDocs.
# Preserva formato: usa el primer parrafo de cada celda como plantilla (pPr + rPr Arial),
# clona para listas numeradas y reemplaza texto. Solo lectura/escritura del .docx.
import copy
import sys
import unicodedata

from docx import Document
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

DOCX = "docs/Form1_Proyde TSP_560_GuidoOlivero.docx"


def norm(s):
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower().strip()


# titulo (substr normalizado) -> lista de parrafos/items
CONTENIDO = {
    "contexto - empresa": [
        "Trading Travel es una agencia de viajes argentina. TravelDocs es su sistema web "
        "multi-tenant para gestionar la documentacion de pasajeros (DNI, pasaportes "
        "ARG/extranjeros, visas) y generar los strings SSR/FOID que se cargan en los GDS "
        "(Amadeus, Sabre, Galileo), con lectura de documentos por IA y analisis de "
        "requisitos de vuelo por pais."
    ],
    "objetivos del proyecto en la organizacion": [
        "El proyecto TravelDocs busca digitalizar y centralizar la gestion documental de "
        "los pasajeros de la agencia, automatizando la carga mediante escaneo con IA y la "
        "generacion de strings SSR/FOID para los GDS, reduciendo errores y tiempos "
        "operativos, con alertas de vencimientos y analisis de requisitos de vuelo por pais."
    ],
    "objetivos del alumno": [
        "Desarrollar el frontend SPA en HTML, CSS y JavaScript vanilla (ES modules).",
        "Implementar el backend multi-tenant sobre Firebase Auth y Firestore con aislamiento por agencia.",
        "Integrar el escaneo de documentos con IA (Gemini) mediante Netlify Functions, con fallback a Claude.",
        "Implementar la generacion de strings SSR/FOID estandar IATA (SRDOCS, SRFOID, SRDOCO, NM infante).",
        "Desarrollar el modulo de requisitos de vuelo por pais y las alertas de vencimientos.",
    ],
    "expectativas del tsp": [
        "Completar la obligacion academica del TSP.",
        "Adquirir experiencia en desarrollo web full-stack y arquitecturas multi-tenant.",
        "Aplicar integracion de servicios de IA en un producto real.",
        "Consolidar un producto desplegable y escalable a multiples agencias.",
    ],
    "equipos - materiales": [
        "PC de desarrollo con VS Code. Frontend en HTML, CSS y JavaScript vanilla (ES "
        "modules, sin framework). Backend en Firebase (Auth, Firestore) con hosting y "
        "Functions serverless en Netlify (Node 20, esbuild). IA con Google Gemini (SDK "
        "@google/genai) y Anthropic Claude como fallback. GDS: Amadeus, Sabre y Galileo. "
        "Control de versiones con Git."
    ],
    "documentacion - fuentes": [
        "Documentacion de Firebase (Auth, Firestore, Security Rules).",
        "Documentacion de Netlify Functions y esbuild.",
        "SDK @google/genai y @anthropic-ai/sdk.",
        "Estandares IATA para strings SSR/FOID (SRDOCS, SRFOID, SRDOCO).",
        "Manuales de los GDS (Amadeus, Sabre, Galileo).",
        "MDN Web Docs para HTML, CSS y JavaScript.",
    ],
}


def replace_cell(cell, items):
    old = cell.paragraphs
    template = old[0]._p
    # rPr del primer run del template (fuente Arial)
    first_r = template.find(qn("w:r"))
    rPr = first_r.find(qn("w:rPr")) if first_r is not None else None
    for text in items:
        new_p = copy.deepcopy(template)
        # borrar runs del clon, deja el pPr (estilo + numPr)
        for r in new_p.findall(qn("w:r")):
            new_p.remove(r)
        r = OxmlElement("w:r")
        if rPr is not None:
            r.append(copy.deepcopy(rPr))
        t = OxmlElement("w:t")
        t.text = text
        t.set(qn("xml:space"), "preserve")
        r.append(t)
        new_p.append(r)
        template.addprevious(new_p)
    for p in old:
        p._p.getparent().remove(p._p)


def main():
    doc = Document(DOCX)
    tbl = doc.tables[0]
    hechos = []
    for row in tbl.rows:
        left = norm(row.cells[0].text)
        for key, items in CONTENIDO.items():
            if key in left and key not in hechos:
                replace_cell(row.cells[1], items)
                hechos.append(key)
                print(f"OK  -> {key}")
                break
    faltan = [k for k in CONTENIDO if k not in hechos]
    if faltan:
        print("FALTARON:", faltan)
        sys.exit(1)
    doc.save(DOCX)
    print("Guardado:", DOCX)


if __name__ == "__main__":
    main()
