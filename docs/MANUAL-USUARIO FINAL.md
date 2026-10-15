# Manual del Usuario

Sistema de gestión de documentos de pasajeros, check-ins y requisitos de vuelo para agencias de viajes.

Versión 1 · octubre de 2026

---

## Índice

1. [Qué es el sistema](#1-que-es-el-sistema)
2. [Requisitos para usar el sistema](#2-requisitos-para-usar-el-sistema)
3. [Ingreso al sistema (login)](#3-ingreso-al-sistema-login)
4. [Primer ingreso: activación del doble factor de seguridad](#4-primer-ingreso-activacion-del-doble-factor-de-seguridad)
5. [Recorrido de la pantalla principal](#5-recorrido-de-la-pantalla-principal)
6. [Dashboard](#6-dashboard)
7. [Pasajeros](#7-pasajeros)
8. [Check ins](#8-check-ins)
9. [Documentos](#9-documentos)
10. [Alertas de vencimiento](#10-alertas-de-vencimiento)
11. [Importación masiva](#11-importacion-masiva)
12. [Requisitos de Vuelo](#12-requisitos-de-vuelo)
13. [Seguridad (doble factor)](#13-seguridad-doble-factor)
14. [Ciudades](#14-ciudades)
15. [Cerrar sesión](#15-cerrar-sesion)
16. [Referencia rápida: estados y colores](#16-referencia-rapida-estados-y-colores)
17. [Preguntas frecuentes y problemas comunes](#17-preguntas-frecuentes-y-problemas-comunes)

---

## 1. Qué es el sistema

El sistema permite a una agencia de viajes:

- Tener una **base de datos de pasajeros** con su documentación: DNI, pasaporte argentino, pasaporte extranjero, visas, asistencias medicas y programas de viajero frecuente.
- **Leer los documentos de forma automatizada**: subís una foto del pasaporte, DNI, visa o Excel y el sistema completa los datos del pasajero solo y sin errores (Las imágenes no se guardan).
- **Generar los strings SSR/FOID** listos para copiar y pegar en el GDS (Amadeus o Sabre).
- **Controlar los check-ins**: cargas la reserva con el PNR o el e-ticket, y el sistema te avisa cuando un vuelo está por salir sin check-in hecho.
- **Recibir alertas de vencimiento** de documentos y cumpleaños de pasajeros.
- **Consultar los requisitos de vuelo** (visas, eTA, tasas, vacunas, paradas técnicas) por nacionalidad y ruta, vuelo, Cía. aérea. Podés pegar el GDS o adjuntar el itinerario en PDF o en foto.


---

## 2. Requisitos para usar el sistema

- Una computadora, tablet o celular con conexión a internet.
- Un navegador moderno (Chrome, Edge, Firefox o Safari actualizados).
- Una cuenta de usuario creada por el administrador de tu agencia (email y contraseña).
- Para el doble factor: un celular con una aplicación de autenticación (por ejemplo Google Authenticator, que se descarga gratis de la tienda de aplicaciones).

---

## 3. Ingreso al sistema (login)

1. Abrí el navegador y entra a traveldocs.com.ar/login.html
2. Se abre la pantalla **"Ingresar a la cuenta"**.
3. Escribí tu **Email** en el primer campo.
4. Escribí tu **Contrasena** en el segundo campo.
5. Hace click en el botón **Ingresar**.

Qué pasa después:

- Si es la **primera vez** que entras, el sistema te va a pedir activar el doble factor de seguridad (ver sección 4).
- Si ya activaste el doble factor, te pide el código de 6 dígitos del autenticador:
  1. Abrí la aplicación de autenticador en tu celular.
  2. Busca el código de **6 dígitos de TravelDocs** que muestra para tu cuenta (cambia cada 30 segundos).
  3. Escribilo en el campo **"Código de 6 dígitos"**.
  4. Hace click en **Validar**.
- Si el email o la contraseña son incorrectos, aparece un mensaje de error en rojo arriba del formulario. Corregí los datos y vuelve a intentar.

> Si ves el mensaje "Tu cuenta no está autorizada", tu usuario todavía no fue habilitado o fue desactivado. Contacta al administrador de tu agencia.

---

## 4. Primer ingreso: activación del doble factor de seguridad

La primera vez que entras, el sistema te obliga a activar el doble factor. Es un paso único, luego no se repite.

### Paso 1: escanear el código QR

1. Al ingresar por primera vez, el sistema muestra la pantalla de configuración con un **código QR**.
2. En tu celular, abrí la aplicación de autenticación (por ejemplo Google Authenticator).
3. En la aplicación, elegí agregar una nueva cuenta y escanea el código QR que ves en pantalla.

### Paso 2: confirmar el código

1. La aplicación del celular empieza a mostrar un código de 6 dígitos para tu cuenta.
2. Escribí ese código en el campo **"Código de 6 dígitos que generó la app"**.
3. Hace click en **Activar autenticador**.

### Paso 3: guardar el código de recuperación (MUY IMPORTANTE)

Si el código es correcto, el sistema muestra **una sola vez** tu **código de recuperación**.

- Ese código es la unica forma de recuperar tu acceso si perdes el celular o desinstalas la aplicación por error.
- El sistema nunca lo vuelve a mostrar y nadie puede consultarlo por vos.

Hace esto SI o SI:

1. Sacale una **foto a la pantalla**, copialo en un administrador de contraseñas, o anotalo en papel y guardalo en un lugar seguro.
2. Si queres tenerlo en el portapapeles, hace click en **Copiar código**.
3. Cuando estes seguro de que lo guardaste, hace click en **Lo guarde, continuar**.

A partir de acá ya entraste al sistema. En cada ingreso futuro vas a necesitar: email + contraseña + código del autenticador.

> Si perdes el teléfono y no guardaste el código de recuperación, un administrador de tu agencia puede resetearte el acceso (ver sección 13). Si guardaste el código, dáselo al administrador cuando te lo pida.

---

## 5. Recorrido de la pantalla principal

Al entrar ves dos zonas: la **barra lateral** (izquierda) y el **área de trabajo** (derecha).

### Barra lateral (menú)

Cada botón del menú te lleva a una sección del sistema:

| Botón | Para que sirve |
|---|---|
| **Dashboard** | Resumen general: números, alertas urgentes y check-ins próximos |
| **Pasajeros** | Lista completa de pasajeros de la agencia. Crear, editar, eliminar y filtrar. |
| **Check ins** | Reservas cargadas. Ver, crear y marcar check-ins |
| **Documentos** | Todos los documentos (DNI, pasaportes, visas, asistencias) en una sola tabla |
| **Alertas** | Documentos vencidos, por vencer y cumpleaños próximos |
| **Importar masivo** | Cargar muchos pasajeros de una vez (carpeta de imágenes o Excel/CSV) |
| **Requisitos de Vuelo** | Consulta de visas, eTA, vacunas y otros requisitos por ruta y nacionalidad. También lee un itinerario en PDF o en foto |
| **Seguridad** | Estado de tu doble factor y gestión del equipo |
| **Ciudades** | Códigos de ciudad de tus consolidadores (Amadeus y Sabre), para copiar al armar el PNR |


Dos detalles útiles:

- Al lado de **Check ins** puede aparecer un número en un círculo: es la cantidad de check-ins pendientes para hoy o mañana.
- Al lado de **Alertas** puede aparecer un número en un círculo rojo: cantidad de alertas urgentes (documentos vencidos o críticos).

### Barra superior

- A la izquierda está el **título de la sección** en la que estás (cambia según el botón del menú que tocaste).
- En el centro/derecha está el **buscador** con el texto "Buscar pasajero...". Lo que escribas ahí filtra la lista de pasajeros por apellido, nombre, número de documento o palabras claves para asociar familias en la celda notas.
- Más a la derecha, el botón azul **Nuevo pasajero**: abre el formulario para crear un pasajero desde cualquier sección.
- En celulares, la barra lateral se esconde y se abre con el botón de **tres rayitas** (menú hamburguesa) de la izquierda.

### Pie de la barra lateral

Abajo a la izquierda ves tu email y tu inicial. Al lado está el botón de **salida** (icono de flecha) para cerrar sesión (ver sección 15).

---

## 6. Dashboard

![Dashboard](imagenes/Dashboard.png)

El Dashboard es la pantalla de inicio. Te da una foto del estado general de la agencia.

### Tarjetas de números (arriba)

| Tarjeta | Significado |
|---|---|
| **Total pasajeros** | Cantidad de pasajeros en la base de datos de tu agencia |
| **Documentación OK** | Pasajeros con todos sus documentos vigentes |
| **Por vencer (90d)** | Pasajeros con algun documento que vence en los próximos 90 días |
| **Vencidos / Críticos** | Pasajeros con documentos vencidos o que vencen en menos de 30 días. Requiere acción urgente |

### Últimas alertas (izquierda)

Lista las alertas más urgentes: documentos vencidos, críticos o cumpleaños en los próximos días. También puede aparecer un viaje de los próximos 30 días, con la pastilla "Verifique los requisitos". El click abre el check-in. Un vuelo dentro de Argentina con pasajeros argentinos no entra en esa lista.

- Hace click sobre una alerta para abrir el **detalle del pasajero**.
- Hace click en **Eliminar** para quitar esa alerta de tu vista (el pasajero NO se borra; ver sección 10).
- Hace click en **Ver todos** (arriba a la derecha de la tarjeta) para ir a la sección Alertas.

### Últimos pasajeros (derecha)

Los 5 pasajeros agregados o modificados últimamente, con su estado general (OK / Atención / Urgente).

- Hace click sobre una fila para abrir el detalle del pasajero.
- Hace click en **Ver todos** para ir a la sección Pasajeros.

### Check-ins para hoy y mañana (abajo)

Tarjeta con los tramos que salen hoy o mañana y todavia no tienen el check-in hecho.

- Hace click sobre uno para abrir la ficha de lectura de ese check-in (códigos de aerolínea, tramos y pasajeros). Desde ahí podes editarlo si hace falta.
- Hace click en **Ver todos** para ir a la sección Check ins.

---

## 7. Pasajeros

### 7.1 Ver y buscar pasajeros

![Lista de pasajeros](imagenes/Pasajeros%20final.png)

1. Hace click en **Pasajeros** en la barra lateral.
2. Ves la tabla con todos los pasajeros de tu agencia. Cada fila muestra: pasajero, fecha de nacimiento, DNI (con su estado), pasaporte argentino (con su estado), pasaporte extranjero, visas y estado general.
3. Para **buscar**, escribí el apellido, nombre o número de documento en el buscador **"Buscar pasajero..."** de la barra superior. La tabla se filtra sola mientras escribis.
4. Para **filtrar por estado**, usa la lista desplegable que está arriba de la tabla, a la izquierda del botón "+ Nuevo pasajero":
   - **Todos**: sin filtro.
   - **Documentación OK**: solo pasajeros con todo vigente.
   - **Por vencer**: documentos que vencen entre 31 y 90 días.
   - **Vencidos / Críticos**: vencidos o por vencer en 30 días o menos.
5. Hace click sobre cualquier **fila** para abrir el detalle del pasajero (sección 7.4).

### 7.2 Crear un pasajero a mano


1. Hace click en el botón azul **"+ Nuevo pasajero"** (arriba a la derecha de la sección Pasajeros, o en la barra superior desde cualquier sección).
2. Se abre la ventana **"Nuevo pasajero"**. Es un formulario largo con secciones; solo tres campos son obligatorios.

**Datos personales** (obligatorios):

- **Apellido** (obligatorio). Se guarda siempre en MAYUSCULAS, sin acentos.
- **Nombre** (obligatorio). Igual: MAYUSCULAS sin acentos.
- **Fecha de nacimiento** (obligatorio). Hace click en el campo y elegí la fecha.
- **Sexo**: Masculino o Femenino.
- **Nacionalidad**: desplegable con todos los países, nombre y código de tres letras (por ejemplo Argentina, ARG).
- **CUIT/CUIL**, **Email de contacto** y **WhatsApp**: opcionales, pero se usan para mandarle mails al pasajero desde la sección Alertas.
- **Observaciones**: notas libres (cliente VIP, infante asociado, preferencias, etc.).

**DNI Argentino**: Número, Fecha emisión y Fecha vencimiento.

**Pasaporte Argentino**: Número (ej: AAI204554), Fecha emisión y Fecha vencimiento.

**Pasaporte Extranjero** (para pasajeros con doble nacionalidad):

- **Apellido y Nombre en este pasaporte**: a veces difieren del nombre en argentino, por eso se cargan aparte.
- **País emisor**: desplegable con todos los países. Si escaneás un pasaporte belga, queda Bélgica (BEL).
- Número, Fecha emisión y Fecha vencimiento.

**Visa**:

1. Hace click en el botón **Agregar** de la sección Visa.
2. Se abre una fila con los campos: País destino (3 letras, ej: USA), Número, Lugar de emisión, Tipo (T Turista / B Business / S Student / I Inmigrante / E ESTA), Pasaporte asociado, Fecha emisión y Fecha vencimiento.
3. Para agregar otra visa, hace click de nuevo en **Agregar**.
4. Para quitar una visa, hace click en la **X** de su fila.

**Asistencia Médica**: mismo mecanismo que las visas. Botón **Agregar** y completas: Compañía aseguradora (ej: ASSIST CARD), Número de voucher, Fecha inicio, Fecha fin, Duración (se calcula sola desde las fechas), Producto (ej: AC300) y Cobertura (ej: USD 300.000).

**Viajero Frecuente**: botón **Agregar** y completas la Aerolinea (código de 2 letras, ej: AA) y el Número de programa. Al escribir el código de aerolínea, el sistema muestra el nombre del programa (ej: "AA - AAdvantage (American Airlines)") para confirmar que escribiste el código correcto.

3. Cuando terminaste, hace click en **Guardar pasajero** (abajo a la derecha de la ventana).

Si falta algun dato obligatorio, aparece el aviso "Completá apellido, nombre y fecha de nacimiento" y no guarda hasta completarlo.

**Control de duplicados**: si ya existe un pasajero con el mismo DNI, el mismo pasaporte o el mismo nombre + fecha de nacimiento, el sistema te avisa con el nombre del pasajero existente y no guarda. Revisa si ese pasajero ya está cargado y edita ese en lugar de crear uno nuevo.

### 7.3 Crear un pasajero leyendo el documento (escaneo)

![Carga de nuevo pasajero](imagenes/CARGA%20NUEVO%20PASAJERO%201.png)

Podes omitir la carga a mano: subís una foto del documento y el sistema completa los datos solo.

1. Hace click en **"+ Nuevo pasajero"**.
2. En la primera sección del formulario, **"Leer documento con OCR (opcional)"**, hace click sobre el recuadro punteado (o arrastra la imagen desde tu computadora hacia el recuadro).
3. Se abre el explorador de archivos. Selecciona una o varias imágenes o PDFs del documento del pasajero:
   - Formatos aceptados: JPG, PNG, WebP, GIF y PDF.
   - Tamaño máximo: 20 MB por archivo.
   - Podes subir **varios documentos a la vez** del mismo pasajero: por ejemplo DNI + pasaporte + visa. El sistema los une todos en la misma ficha.
   - Una captura de viajero frecuente, de cualquier aerolínea, completa solo esa sección: código de aerolínea y número de programa. El resto de la ficha queda como está.
4. Espera mientras se procesan los archivos. Arriba del recuadro aparece una animación de pasaporte con el avance. Si subís varios, se procesan de a uno (hay una pausa de unos segundos entre archivo y archivo).
5. Al terminar, el formulario se completa solo con los datos leídos y aparece el mensaje "N documento(s) del pasajero base procesado(s)".

Detalles importantes del escaneo:

- **Si subís documentos de varias personas mezclados**, el sistema detecta que son pasajeros distintos: completa la ficha con el primero y muestra el aviso "Se detectaron N pasajero(s) distinto(s) en M archivo(s)". Con el botón **"Agregar N pasajero(s) detectado(s)"** podes darlos de alta a todos de una vez. Los que ya existen en la base se omiten.
- **Si escaneas sobre un pasajero existente** (editándolo), el sistema pregunta antes de sobrescribir un dato que ya tenía valor cargado: confirma campo por campo que queres reemplazar.
- **Revisa siempre** los datos leídos antes de guardar: corregí cualquier error de lectura en los campos del formulario (los campos quedan editables).
6. Completa lo que falte (los tres campos obligatorios son apellido, nombre y fecha de nacimiento) y hace click en **Guardar pasajero**.

### 7.4 Ver el detalle de un pasajero

1. Hace click sobre la fila del pasajero en la tabla (o sobre su nombre en Dashboard/Alertas).
2. Se abre la ventana de detalle con:

**Columna izquierda**: nombre, estado general de su documentación, fecha de nacimiento, edad, sexo, nacionalidad, email, WhatsApp y observaciones.

**Columna derecha**:

- Una **tarjeta por cada documento** cargado (DNI, pasaporte ARG, pasaporte extranjero, visas, asistencias) con: número, fecha de emisión, fecha de vencimiento, cuántos días le quedan y el semáforo de estado.
- La sección **Strings SSR** (sección 7.5).

### 7.5 Strings SSR para el GDS

En el detalle del pasajero, abajo, está la tarjeta **"Strings SSR"**. Ahi el sistema arma automáticamente los comandos listos para pegar en el GDS, según la documentación cargada del pasajero.

1. En el desplegable **GDS** (arriba a la derecha de la tarjeta) elegí tu sistema: **Amadeus** o **Sabre**. La lista de strings se regenera al instante para el formato elegido, y el sistema recuerda tu elección para la proxima vez.
2. La lista muestra un string por cada dato disponible. Por ejemplo, para un pasajero con pasaporte argentino, DNI, visa de USA, email y celular:
   - **NM** con el nombre completo (formato GDS).
   - **SRDOCS / DOCS** del pasaporte argentino.
   - **SRDOCS / DOCS** del pasaporte extranjero (si tiene).
   - **SRDOCS corto** (solo nombre).
   - **SRDOCS / DOCS** del DNI y **SRFOID** del DNI.
   - **SRDOCO / DOCO** de cada visa.
   - **SRCTCE / CTCE** con el email codificado para GDS (guiones bajos y medios se codifican según estándar IATA).
   - **SRCTCM / CTCM** con el celular.
   - **FSR** con el CUIT/CUIL.
   - **FFN** de cada programa de viajero frecuente.
3. Hace click en **copiar** (botón a la derecha de cada string) y pegalo directamente en el GDS.

> Los formatos SSR/FOID son estándares IATA: no se modifican. Si un string sale mal, revisa que los datos del pasajero estén bien cargados.

### 7.6 Editar un pasajero

1. En la tabla de Pasajeros, hace click en el **icono de lápiz** de la fila del pasajero (última columna), o abrí el detalle y hace click en **Editar**.
2. Se abre el mismo formulario de carga, ya completado con los datos actuales.
3. Modifica lo que necesites y hace click en **Guardar pasajero**.

### 7.7 Eliminar un pasajero

1. En la tabla de Pasajeros, hace click en el botón rojo **Eliminar** de la fila del pasajero.
2. Se abre una ventana de confirmación: "Estás por eliminar a [nombre] de la base de datos. ¿Estás seguro?".
3. Hace click en **"Sí, eliminar pasajero"** para confirmar, o en **Cancelar** si te equivocaste.

> Ojo: eliminar un pasajero borra todos sus datos y no se puede deshacer.

---

## 8. Check ins

Esta sección lleva el control de las reservas y sus check-ins. Cada reserva puede tener uno o varios **tramos** (por ejemplo: ida EZE-MAD y vuelta MAD-EZE), y cada tramo tiene su propio check-in.

### 8.1 Crear un check-in pegando el PNR

![Creación de check-ins](imagenes/Creacion%20de%20Check%20Ins.png)

Esta es la forma más rápida. El sistema lee el PNR pegado y completa el formulario solo.

1. En la barra lateral, hace click en la pestaña **Check ins**.
2. Arriba a la derecha, hace click en el botón azul **"+ Nuevo check-in"**.
3. Se abre la ventana **"Nuevo check-in"**. En el campo grande de la sección **"Pegar PNR o adjuntar e-ticket"** (con el título "Copia el PNR del GDS"), pega el texto del PNR copiado del GDS (Sabre o Amadeus). El texto tiene que incluir:
   - Las **líneas con los nombres de los pasajeros** (formato APELLIDO/NOMBRE).
   - Las **líneas de los vuelos** (número de vuelo, fechas, ciudades, horarios).
4. Hace click en el botón **"Decodificar PNR"**.
5. Espera unos segundos mientras el sistema procesa el PNR. Al terminar, aparecen en verde el mensaje "PNR interpretado. Revisá los datos antes de guardar." y un cuadro de resumen con:
   - **"N pasajero(s) · M asociado(s) a la base"**: cuántos pasajeros tenía el PNR y cuántos encontró ya cargados en tu base de Pasajeros. Los encontrados quedan **agregados automáticamente** al check-in.
   - Si hay pasajeros del PNR que NO están en la base, se listan en rojo: "No encontrados en la base (darlos de alta en Pasajeros)". Para esos: cancela este check-in, cargalos primero en la sección Pasajeros (sección 7) y volve a crear el check-in, o agregalos a mano con el buscador (paso 8).
   - Los **tramos del viaje**, ya cargados en la sección "Datos del vuelo" con: número de vuelo, origen, destino, escalas, fecha y hora de salida (en horario Argentina).
   - La **reserva de aerolínea para el check-in web** (el código de la CIA, por tramo si hay más de una).
6. **Revisa que los datos estén bien**: corregí en cada tramo lo que haga falta (los campos son editables):
   - **Vuelo**: número (ej: IB110).
   - **Origen** y **Destino**: códigos IATA de 3 letras (ej: EZE, MAD).
   - **Escalas (IATA, coma)**: si el tramo tiene escalas, escribilas separadas por coma (ej: GRU,SCL). Si no tiene, deja el campo vacío.
   - **Salida**: fecha y hora de salida del vuelo (obligatorio; los tramos sin fecha no se guardan).
   - **Check-in**: Sí o No, si ya le hiciste el check-in a ese tramo.
   - Para quitar un tramo sobrante, hace click en la **X** de la fila del tramo. Para agregar otro a mano, hace click en **"+ Agregar tramo"**.
7. En la sección **"Datos del vuelo"**, arriba de los tramos, revisa:
   - **Reserva aerolínea (check-in web)**: el código que usa la aerolínea para el check-in por internet (ej: KRBJJ). Es el que copiás en la web de AA, IB, AR, etc. No se muestra el record locator del GDS para no mezclarlo con este código.
   - **Compañía aérea** (obligatorio): el código de la aerolínea (ej: AA, AR, LA, IB). Al escribirlo, abajo aparece el nombre de la aerolínea (ej: "AA - American Airlines") para que confirmes que es el correcto.
   - Si el itinerario tiene tramos de **aerolíneas distintas**, esas dos casillas de arriba desaparecen y el aviso "Itinerario multi-aerolínea: completá la aerolínea y el código de reserva de cada tramo" te pide completar la aerolínea y el código de reserva **dentro de cada tramo**.
8. En la sección **"Pasajeros"**:
   - Los pasajeros reconocidos ya quedaron agregados (los ves listados arriba).
   - Para agregar otro pasajero, escribí su apellido o nombre en **"Buscar pasajero para agregar..."** y hace click sobre el resultado (aparece un + a la derecha). Podes agregar todos los que viajen juntos.
   - Para quitar un pasajero, hace click en **Quitar** junto a su nombre.
9. En la sección **"Aviso de check-in"** (opcional):
   - **Email para el aviso**: si el aviso de este check-in tiene que llegar a otro email (por ejemplo, el del pasajero), escribilo acá. Vacío = se usa el email de alertas de la agencia.
   - **Avisar con anticipación**: con cuánta anticipación querés el aviso: **24 horas** antes (día previo, lo normal), **48 horas** (2 días) o **72 horas** (3 días).
10. Hace click en **"Guardar check-in"** (abajo a la derecha).

El sistema valida antes de guardar:

- Que haya **al menos un tramo con fecha**.
- Que **todos los tramos tengan compañía aérea**.
- Que el viaje **no esté duplicado**: si el mismo pasajero ya tiene cargado el mismo vuelo en la misma fecha en otro check-in, avisa "Ese viaje ya está cargado para..." y no guarda (evita alertas repetidas).

Si todo está bien, aparece "Check-in creado" y el check-in queda en la lista. En ese momento sale el mail de requisitos del destino (sección 8.7). Editar un check-in que ya existía no lo vuelve a mandar.

### 8.2 Crear un check-in adjuntando el e-ticket

Alternativa al pegado del PNR: subís el e-ticket en PDF y el sistema lo lee solo.

1. Hace click en **Check ins** en la barra lateral.
2. Hace click en **"+ Nuevo check-in"**.
3. En la sección **"Pegar PNR o adjuntar e-ticket"**, hace click en el botón **"Adjuntar e-ticket PDF"**.
4. Selecciona el archivo PDF del e-ticket o itinerario. Podes elegir **varios a la vez** (por ejemplo, uno por pasajero cuando cada uno tiene el suyo). Límites: PDF de hasta 2 MB cada uno, máximo 8 archivos, y entre todos no más de 4 MB.
5. El sistema los procesa automáticamente y completa el formulario igual que con el PNR: tramos, aerolínea, **código de reserva de cada CIA** y búsqueda de pasajeros en la base. Si el itinerario tiene más de una aerolínea, cada tramo queda con su código.
6. Segui desde el paso 6 de la sección 8.1: revisa los datos, completa lo que falte y hace click en **"Guardar check-in"**.

> Los PDF se leen una sola vez para extraer los datos. No quedan guardados ni adjuntos al check-in.

### 8.3 Crear un check-in a mano (sin PNR ni e-ticket)

1. Hace click en **Check ins** -> **"+ Nuevo check-in"**.
2. Deja el campo del PNR vacío y completa a mano:
   - **Reserva aerolínea (check-in web)** y **Compañía aérea**.
   - Hace click en **"+ Agregar tramo"** y completa: vuelo, origen, destino, escalas, fecha/hora de salida. Agrega un tramo por cada vuelo del viaje (ida y vuelta son dos tramos).
3. Agrega los pasajeros con el buscador de la sección Pasajeros.
4. Hace click en **"Guardar check-in"**.

### 8.4 La lista de check-ins

![Lista de check-ins](imagenes/Check%20ins.png)

Cada check-in de la lista muestra:

- **Apellidos de los pasajeros**, aerolínea y código de check-in web (el de la CIA).
- Los **tramos** con su ruta y fecha (ej: "EZE→MAD 08 jul 08:45hs · MAD→EZE 29 jul 16:05hs") y la cantidad de pasajeros.
- Una **etiqueta de color por tramo**:
  - Verde con un check: check-in ya hecho.
  - Rojo "pronto": el vuelo sale hoy o mañana y no tiene check-in hecho.
  - Azul "pasado": vuelo ya realizado.
  - Amarillo: vuelo futuro.
- Botones de acción a la derecha:
  - **"[Ruta]: Check-in"**: marca el check-in de ese tramo como hecho. Una vez marcado, el mismo botón dice **"Desmarcar"** para volver atras.
  - **Editar**: abre el formulario para modificar tramos, códigos o pasajeros.
  - **Eliminar** (en rojo): borra el check-in (pide confirmación).
- El buscador de arriba de la lista filtra los check-ins por nombre o apellido del pasajero.

Los check-ins viejos se limpian solos: cuando todos los tramos de un viaje ya volaron, el check-in se borra de la lista al día siguiente (un vuelo del 10 de octubre desaparece el 11). No hace falta eliminarlos a mano.

Hace click en la **tarjeta** (no en esos botones) para abrir la ficha de lectura. Ver sección 8.5.

### 8.5 Ver un check-in (ficha de lectura)

1. Hace click sobre la tarjeta del check-in en la lista, o sobre un ítem de **"Check-ins para hoy y mañana"** en el Dashboard.
2. Se abre una ventana de **solo lectura** (no el formulario de carga). Ahí ves:
   - Los **códigos de reserva por CIA**, cada uno con su aerolínea y un botón **copiar**. Si hay una sola aerolínea y un solo código, aparece una vez (no se repite en cada tramo). Si hay varias (por ejemplo AF e IB), cada código queda junto a su CIA y también en el tramo que le corresponde.
   - Los **tramos**: ruta, número de vuelo, fecha y si el check-in de ese tramo ya está hecho.
   - Los **pasajeros**, con nombre y fecha de nacimiento. Abajo del título dice "Tocá un nombre para abrir la ficha".
   - El **aviso**: a qué email va el recordatorio y con cuánta anticipación está configurado (24, 48 o 72 horas).
3. Hace click en un **pasajero** para ver su ficha: datos personales, documentos y vencimientos. Desde acá **no** se edita, **no** se copian strings SSR y **no** hay botón de copiar: es para consultar (nacimiento, pasaporte, etc.) y volver al check-in. Cerrá esa ventana y seguís en la ficha del viaje.
4. Si hay que modificar algo del viaje, hace click en **Editar** (arriba de la ficha o en la lista). Ahí sí está el formulario: PNR del GDS para decodificar, PDF, tramos y pasajeros.
5. Para marcar el check-in de un tramo como hecho no hace falta abrir la ficha: usá el botón de la lista.

### 8.6 Avisos de check-in pendiente

- En la barra lateral, el número junto a **Check ins** indica cuántos tramos salen hoy o mañana sin check-in hecho.
- En el Dashboard, la tarjeta **"Check-ins para hoy y mañana"** los lista.
- Los avisos por email salen solos, una sola vez por tramo, de dos formas:
  - Todos los días a las **9 de la mañana** llega un email a la dirección de alertas de la agencia con los check-ins pendientes, aunque nadie haya abierto el sistema.
  - Si alguien de la agencia entra al sistema dentro del plazo de aviso de un vuelo (según la anticipación elegida al crearlo: 24, 48 o 72 horas antes de la salida), el aviso de ese vuelo sale en ese momento, sin esperar a las 9.

### 8.7 Mail de requisitos al crear el check-in

Al guardar un check-in nuevo sale un mail con los tramos, los pasajeros y los requisitos de visa y sanidad. El formato es el de los otros avisos: fondo crema, el nombre de la agencia y la fecha. Dice Pasajera o Pasajero según el sexo cargado en la ficha, y "Usted tiene" con los pasaportes. Si dos personas comparten destino y pasaporte, el texto de visa y de sanidad sale una sola vez. Los países con el mismo texto se juntan. El título dice "Destino" si es uno y "Destinos" si son más. La vuelta a un país que la base no tiene, como Argentina, no aparece. Con un solo país el asunto dice "para este destino". Con varios, "para estos destinos".

El mail va al email cargado en el check-in. Si ese campo está vacío, va al de alertas de la agencia, igual que el aviso de 24, 48 o 72 horas.

Sale al guardar. Si en ese momento faltan más de 30 días, el mail avisa que vuelve a llegar 30 días antes de la salida, y sale de nuevo cuando el viaje entra en esos 30 días, sin esa frase. Si al guardarlo ya faltan 30 días o menos, queda ese único mail. El aviso de 24, 48 o 72 horas es otro mail y sigue igual.

Un vuelo dentro de Argentina, con todos los pasajeros argentinos en la ficha, no manda ese mail: alcanza el DNI. Si hay un pasajero con otra nacionalidad, por ejemplo Australia, el mail sale y dice que ese pasajero viaja con pasaporte.

A las 9 de la mañana sale el mail de los 30 días. Si al guardar no pudo salir, esa corrida lo manda cuando al viaje le faltan 30 días o menos.

---

## 9. Documentos

Vista unificada de todos los documentos de todos los pasajeros.

1. Hace click en **Documentos** en la barra lateral.
2. Arriba hay pestañas de filtro rapido: **Todos**, **DNI**, **Pasaporte ARG**, **Pas. Extranjero**, **Visas**, **Asistencias Médicas**. Hace click en una para ver solo ese tipo.
3. La tabla lista cada documento con: pasajero, tipo, pais, número, fecha de emisión, fecha de vencimiento y estado (semáforo).
4. La tabla está **ordenada por vencimiento**: los documentos que vencen primero (o ya vencieron) aparecen arriba. Es útil para detectar urgencias de un vistazo.
5. Hace click sobre una fila para abrir el detalle del pasajero dueño del documento.

---

## 10. Alertas de vencimiento

![Alertas de vencimiento](imagenes/Alertas%20de%20Vencimiento.png)

1. Hace click en **Alertas** en la barra lateral.
2. La pantalla está organizada en bloques, de más urgente a menos:

| Bloque | Qué contiene |
|---|---|
| **Vencidos y críticos (0-30 días)** (rojo) | Documentos vencidos o que vencen en el próximo mes. Acción inmediata |
| **Por vencer (31-90 días)** (amarillo) | Documentos que vencen en los próximos 3 meses |
| **DNI, Visas y Pasaporte - Vencen en 6 meses (91-180 días)** (azul) | Documentos a renovar con tiempo. Incluye el botón **"Notificar a todos por email"** |
| **Cumpleaños próximos (30 días)** (violeta) | Cumpleaños de pasajeros en el próximo mes |
| **Viajes a verificar requisitos migratorios y sanitarios (30 días)** (azul) | Check-ins que salen dentro de 30 días. El click abre el check-in, no la ficha del pasajero. Un vuelo dentro de Argentina con pasajeros argentinos no aparece. Si la lista pasa de cinco, abajo dice **Ver todos** |

Acciones disponibles en cada alerta:

- **Click sobre la alerta**: abre el detalle del pasajero.
- **Icono de sobre (mail)**: si el pasajero tiene email cargado, abre tu programa de correo con un mail ya redactado para pedirle la renovación (o felicitarlo, si es cumpleaños). Revisalo y envialo.
- **Botón "Notificar a todos por email"** (solo bloque de 6 meses): abre tu correo con un único mail para todos los pasajeros del bloque, con el detalle de cada documento por vencer.
- **Botón "Eliminar"**: quita esa alerta de TU vista. Pide confirmación. Importante: la alerta se elimina solo para vos (cada agente maneja sus alertas vistas); el pasajero y sus documentos no se tocan.

> Los emails de renovación y los avisos de check-in se envían desde tu propio correo cuando usas los botones de mail; el sistema los deja redactados listos para enviar.
>
> Además, todos los días a las 9 de la mañana el sistema envía un email a la dirección de alertas de la agencia con los vencimientos, los check-ins pendientes y los cumpleaños del día, aunque nadie haya abierto el sistema. Si alguien entra antes, ese día el email sale en ese momento. El cumpleaños entra en ese mail solo si es hoy. El mail de requisitos del destino sale al crear el check-in y otra vez a las 9 cuando el viaje entra en los 30 días (sección 8.7). Si el check-in se creó ya dentro de esos 30 días, no se repite.

---

## 11. Importación masiva

![Importación masiva](imagenes/Importacion%20Masiva.png)

Para cargar muchos pasajeros de una sola vez, sin cargarlos de a uno. Hay dos formas: carpeta de imágenes o planilla Excel/CSV.

### 11.1 Desde una carpeta de imágenes

Ideal cuando tenes fotos, escaneos o PDF de pasaportes y visas de muchos pasajeros.

1. Hace click en **Importar masivo** en la barra lateral.
2. Hace click sobre el recuadro **"Selecciona la carpeta de documentos"**, o arrastra las imágenes y los PDF al recuadro.
3. Requisitos:
   - Imágenes: JPG, PNG o WebP. Máximo 4 MB por imagen.
   - PDF: máximo 20 MB por archivo.
   - Podes meter en la misma carpeta documentos de varios pasajeros distintos: el sistema los agrupa solo por persona.
4. Empieza el procesamiento: verás una barra de progreso con el nombre del archivo que está leyendo y el contador (ej: "12 / 40"). Un tip: el proceso lee cada archivo en orden, así que las carpetas grandes pueden tardar varios minutos. No cierres la página.
5. Al terminar aparece la tabla **"Revisa los resultados"** con un resumen: "N pasajero(s) detectado(s)". Cada tarjeta muestra:
   - Nombre y fecha de nacimiento detectados. Si falta algun dato obligatorio, aparece en rojo ("Sin apellido", "Sin fecha de nacimiento") y la tarjeta queda marcada con un borde amarillo.
   - Los documentos detectados como etiquetas azules (ej: "Pas. ARG AAI204554", "DNI 39171901", "Visa USA 17317323").
   - Los archivos de donde salieron esos datos.
   - Si el pasajero **ya existe** en la base, la tarjeta queda gris con la marca "Ya existe - se omitirá".
   - Botón **X** para quitar de la lista un pasajero que no quieras importar.
6. Hace click en **Guardar todos**. El sistema crea todos los pasajeros nuevos de una vez y salta los duplicados.
7. Aparece el resumen del resultado (ej: "18 importado(s) - 5 ya existían (omitidos)") y el sistema te lleva a la sección Pasajeros.
8. Si en lugar de guardar queres cancelar todo, hace click en **Cancelar**.

> Los pasajeros importados con datos faltantes (por ejemplo sin fecha de nacimiento) no se guardan. Buscalos en la tabla de revisión, completalos después a mano desde Pasajeros.

### 11.2 Desde Excel / CSV

Para cuando tenes la base en una planilla.

1. Hace click en **Importar masivo**.
2. Hace click en el botón **"Importar desde Excel/CSV"** (está abajo del recuadro de carpeta).
3. Elegí el archivo `.xlsx`, `.xls` o `.csv`.
4. La planilla tiene que tener una fila de encabezados y (como mínimo) estas columnas:

   `APELLIDO | NOMBRE | DNI | VTO DNI | PASAPORTE | VTO PASS | FECHA NAC | CUILS`

   También acepta variantes de nombres de columna (por ejemplo "APELLIDOS", "VENCIMIENTO PASAPORTE", "FECHA DE NACIMIENTO", "CUIT", etc.) y columnas extra de contacto como TELÉFONO/CELULAR, DIRECCIÓN, LOCALIDAD, PROVINCIA y CÓDIGO POSTAL.
5. Al procesarse, aparece la misma tabla de revisión que en el punto 11.1: revisa, quita lo que no quieras y hace click en **Guardar todos**.

---

## 12. Requisitos de Vuelo

![Requisitos de Migraciones y Salud](imagenes/Requisitos%20de%20Migraciones%20y%20Salud.png)

Consulta de visas, eTA, tasas de ingreso, vacunas y paradas técnicas que no figuran en el GDS, para una ruta y una nacionalidad.

1. Hace click en **Requisitos de Vuelo** en la barra lateral.
2. Elegí el modo de consulta con los tres botones de la parte superior:

### Modo "Vuelo individual"

Para consultar un vuelo puntual.

1. Asegurate de que esté activo el botón **"Vuelo individual"**.
2. Completa:
   - **Número de vuelo** (obligatorio): formato aerolínea + número (ej: MU746, AR1102, AA100).
   - **Origen (IATA)** (obligatorio): código de 3 letras del aeropuerto de salida (ej: EZE).
   - **Destino (IATA)** (obligatorio): código de 3 letras del aeropuerto de llegada (ej: AUA).

### Modo "Pegar segmentos GDS"

Para itinerarios completos de varios vuelos.

1. Hace click en el botón **"Pegar segmentos GDS"**.
2. En el cuadro de texto grande, pega las líneas de vuelo del itinerario copiadas del GDS (Amadeus, y también formatos de Sabre o WorldSpan). Por ejemplo:

   ```
   2  MU 746 R 28APR 2*EZEPVG HK1  0215 1810  29APR  E  CA/QBRHFZ
   3  MU5325 R 29APR 3*PVGCAN HK1  2225 0050  30APR  E  CA/QBRHFZ
   ```

3. En cuanto pegas el texto, abajo aparece el resumen de detección: **"N tramos detectados"**, cada uno con su vuelo, origen, destino y fecha. Si no aparece nada, las líneas pegadas no tienen un formato reconocible: copia de nuevo las líneas de vuelo desde el GDS.

### Modo "Itinerario"

Para leer el e-ticket o una foto del itinerario, sin copiar los segmentos.

1. Hace click en el botón **"Itinerario"**.
2. Hace click en **Adjuntar itinerario**, o arrastrá el archivo al recuadro. Acepta un PDF o una foto (JPG, PNG, WebP, GIF o HEIC).
3. Si encuentra los vuelos, aparece **"N tramos listos para consultar"**, con vuelo, origen, destino y fecha. Toma hasta 12 tramos. El PDF puede pesar hasta 8 MB y tener hasta 20 páginas. La foto, hasta 20 MB.
4. Si no es un PDF ni una foto, avisa y no lo lee. Si no ve el número de vuelo, la fecha y los aeropuertos, también avisa. En ese caso pegá los segmentos en **Pegar segmentos GDS**.

### Consulta (común a los tres modos)

3. Completa los campos de abajo:
   - **Fecha de viaje**: opcional, ayuda a afinar la vigencia de los requisitos.
   - **Nacionalidad del pasajero** (obligatorio): desplegable con los países.
4. Hace click en **Consultar requisitos**.
5. La consulta tiene dos etapas: primero "Analizando..." y después "Verificando requisitos en la web...". Puede tardar hasta un minuto en itinerarios largos. No cierres la página.
6. El botón **Limpiar** resetea el formulario para una consulta nueva.

### Leer los resultados

- **Barra superior del vuelo**: número, aerolínea, ruta completa, duración aproximada y el nivel de **certeza de la ruta** (alta/media/baja) con el que el sistema pudo reconstruir el vuelo, incluyendo escalas técnicas que no figuran en el GDS.
- **ALERTAS CRÍTICAS - Comunicar al pasajero antes de volar**: franja roja con los puntos que hay que avisar si o si (ej: visa obligatoria, formulario de salud, vacuna exigida).
- **Pestanas de paradas**: una pestaña por cada punto del viaje (origen, escalas, destino). Cada pestaña indica:
  - **"Requisitos"** (rojo): esa parada tiene requisitos que revisar.
  - **"Parada técnica"**: escala sin cambio de avión; en algunos países igual exige requisitos de tránsito.
  - **"Verificar"** (verde): sin requisitos detectados.
  Hace click en cada pestaña para ver sus requisitos.
- **Tarjetas de requisito**: dentro de cada parada, cada requisito se muestra con su categoría (VISA, eVISA, eTA, TRÁNSITO, VACUNA, MEDICACIÓN, PLF, DECLARACIÓN, SEGURO), si es **Obligatorio** o **Recomendado**, su descripción, costo aproximado, anticipación recomendada y el link **"Sitio oficial"** para tramitarlo o consultar la fuente.
- Si una parada no exige nada, ves el cartel **"Libre de visa"** (ej: "Pasaporte ARG ingresa sin visa a CHINA").
- Las pestañas no repiten un aeropuerto que ya apareció. Si el pasajero vuelve al país de donde salió y ese país es el suyo, la llegada de vuelta no abre otra ficha. El tramo sigue en la barra del vuelo.

> **Aviso legal**: la información es orientativa. Confirma siempre fuentes oficiales del gobierno antes de emitir.

---

## 13. Seguridad (doble factor)

1. Hace click en **Seguridad** en la barra lateral.
2. Arriba ves el estado de tu propia cuenta:
   - **"2FA activo"**: tu cuenta ya usa el autenticador. No tenes que hacer nada.
   - **"2FA pendiente"**: todavía no activaste el autenticador. Cerrá sesión y volve a ingresar para que el sistema te guíe (sección 4).

### Gestión del equipo (solo dueño o administrador de la agencia)

Si tu rol es owner, abajo ves **"2FA de los miembros de la agencia"** con la lista de todos los usuarios de tu agencia y el estado de cada uno (activo / pendiente).

- **Refrescar**: actualiza la lista.
- **Resetear**: para el caso de un miembro que perdió el teléfono. El sistema te pide **un código de recuperación otorgado por ese miembro** (el que guardó cuando activó su autenticador). Al confirmar, el doble factor del miembro queda desactivado y deberá reconfigurarlo en su próximo ingreso. Nunca resetees el 2FA de un miembro sin su pedido y su código.

---

## 14. Ciudades

Códigos de ciudad (office ID / PCC) de tus consolidadores en Amadeus y Sabre, para copiar cuando armas el PNR. Cada agencia carga los suyos: los ve todo el equipo.

1. Hace click en **Ciudades** en la barra lateral (debajo de Seguridad).
2. Hace click en **Agregar ciudad**.
3. Completá el **título** (ej: Ciudad Ricale), elegí **Amadeus** o **Sabre** en el desplegable y el **código**.
4. Hace click en **Guardar**. La ciudad queda fija: título, CIA y código, con botón **copiar**.
5. **Editar** vuelve a abrir el formulario de esa ciudad. La **x** la quita.

Si hay una sola ciudad de un GDS, igual se carga con Agregar ciudad (ya no hay filas fijas vacías de Amadeus y Sabre).

---

## 15. Cerrar sesión

1. Hace click en el **icono de salida** (flecha) que está abajo de la barra lateral, al lado de tu email.
2. El sistema cierra tu sesión y vuelve a la pantalla de ingreso.

Consejo: cerrar sesión al terminar el día es buena práctica, especialmente en computadoras compartidas.

---

## 16. Referencia rápida: estados y colores

El sistema usa un semáforo de vencimientos en todas las vistas:

| Estado | Color | Significado |
|---|---|---|
| **Vencido** | Rojo | El documento ya venció |
| **Crítico** | Rojo | Vence en 30 días o menos (0 a 30) |
| **Por vencer** | Amarillo | Vence entre 31 y 90 días |
| **Vigente / OK** | Verde | Vence en más de 90 días |
| **Sin datos** | Gris | El pasajero no tiene documentos cargados |

Estados de tramos en Check ins:

| Etiqueta | Significado |
|---|---|
| Verde con check | Check-in de ese tramo hecho |
| Rojo "pronto" | Vuelo hoy o mañana sin check-in |
| Azul "pasado" | Vuelo ya realizado |
| Amarillo | Vuelo futuro |

---

## 17. Preguntas frecuentes y problemas comunes

**Me dice "Tu cuenta no está autorizada".**
Tu usuario no existe, está desactivado, o tu agencia está suspendida. Contacta al administrador de tu agencia para que revise tu cuenta.

**Me dice "Sesión expirada. Volve a ingresar.".**
Paso mucho tiempo sin actividad. Cerrá la sesión, volve a ingresar con email, contraseña y código del autenticador.

**Perdí el celular con el autenticador.**
Si guardaste el código de recuperación: pedile a un administrador de tu agencia que use "Resetear" en la sección Seguridad y dale tu código. Si tampoco tenes el código, igualmente contactalo: tendrá que gestionar el alta nuevamente.

**El PNR no se interpreta / el botón Decodificar PNR da error.**
- Verifica que pegaste el PNR completo: tiene que incluir las líneas de nombres y las líneas de vuelos.
- No pegues líneas de vuelos ya realizados (status FLWN); se ignoran.
- Revisa tu conexión a internet e intenta de nuevo. Si sigue fallando, avisa al administrador de la plataforma.

**El e-ticket PDF no se procesa.**
- Tiene que ser un PDF (no una foto del e-ticket): si tenes la foto, usa mejor el campo del PNR o crealo a mano.
- Límite: 2 MB por PDF, máximo 8 por vez, 4 MB en total.

**En Requisitos de Vuelo no me lee el itinerario.**
Tiene que ser un PDF o una foto, con el número de vuelo, la fecha y los aeropuertos a la vista. El PDF hasta 8 MB y 20 páginas. La foto hasta 20 MB. Si igual no lo toma, pegá los segmentos en Pegar segmentos GDS.

**En la ficha del check-in no veo el PNR del GDS.**
Es a propósito: ahí se muestran los **códigos de la CIA** (los del check-in web). El PNR de Amadeus o Sabre se usa al crear o editar (pegar y decodificar), no en la ficha de lectura.

**Pegue un PNR y algunos pasajeros figuran "No encontrados en la base".**
Esos pasajeros no están cargados en tu base de Pasajeros. Dalos de alta primero (a mano o con el escaneo del documento, sección 7) y después agregalos al check-in con el buscador, o volve a decodificar el PNR.

**No quiero crear el mismo check-in dos veces.**
No hace falta: el sistema bloquea los duplicados (mismo pasajero + mismo vuelo + misma fecha) automáticamente.

**No me llegó el email de check-in / de vencimiento.**
Los avisos automáticos salen todos los días a las 9 de la mañana (vencimientos, check-ins pendientes y cumpleaños del día), aunque nadie abra el sistema. Si alguien de la agencia entra dentro de las horas previas a un vuelo, el aviso de ese check-in sale en ese momento. El mail de requisitos del destino sale al guardar el check-in nuevo, y otra vez cuando faltan 30 días si el viaje estaba más lejos. Si al crearlo ya faltaban 30 días o menos, queda un solo mail. Si igual no llega, avisa al administrador para revisar la dirección de alertas de la agencia.

**Eliminé una alerta por error.**
La alerta se eliminó solo de tu vista. Si volves a entrar con otro usuario (o el administrador revisa), la alerta sigue apareciendo para los demas. No hay forma de restaurarla en tu usuario, pero el dato siempre lo ves en la sección Documentos.

**El escaneo de un documento cargó mal un dato.**
Los campos quedan editables después del escaneo: corregilo a mano antes de guardar. La lectura es automatica y puede equivocarse con fotos borrosas o con luz mala; usa fotos nítidas y sin reflejos.

**Los strings SSR no aparecen en el detalle del pasajero.**
Solo se generan los strings de los datos cargados. Si el pasajero no tiene pasaporte, DNI ni visa cargados, la lista aparece vacía ("Sin documentos cargados"). Completa su documentación primero.

**Otros usuarios de mi agencia ven pasajeros distintos a los míos.**
No debería pasar: todos los usuarios de una agencia ven la misma base. Las únicas vistas personales son las alertas que cada uno eliminó. Si ves bases distintas, avisa al administrador.

**¿Puedo estar en dos agencias con el mismo usuario?**
No. Cada usuario pertenece a una sola agencia.

---

*Manual del usuario - versión 1 (agosto 2026).*
