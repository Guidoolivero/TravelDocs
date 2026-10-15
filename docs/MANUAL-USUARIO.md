# Manual del Usuario

Sistema de gestion de documentos de pasajeros, check-ins y requisitos de vuelo para agencias de viajes.

---

## Indice

1. [Que es el sistema](#1-que-es-el-sistema)
2. [Requisitos para usar el sistema](#2-requisitos-para-usar-el-sistema)
3. [Ingreso al sistema (login)](#3-ingreso-al-sistema-login)
4. [Primer ingreso: activacion del doble factor de seguridad](#4-primer-ingreso-activacion-del-doble-factor-de-seguridad)
5. [Recorrido de la pantalla principal](#5-recorrido-de-la-pantalla-principal)
6. [Dashboard](#6-dashboard)
7. [Pasajeros](#7-pasajeros)
8. [Check ins](#8-check-ins)
9. [Documentos](#9-documentos)
10. [Alertas de vencimiento](#10-alertas-de-vencimiento)
11. [Importacion masiva](#11-importacion-masiva)
12. [Requisitos de Vuelo](#12-requisitos-de-vuelo)
13. [Seguridad (doble factor)](#13-seguridad-doble-factor)
14. [Ciudades](#14-ciudades)
15. [Cerrar sesion](#15-cerrar-sesion)
16. [Referencia rapida: estados y colores](#16-referencia-rapida-estados-y-colores)
17. [Preguntas frecuentes y problemas comunes](#17-preguntas-frecuentes-y-problemas-comunes)

---

## 1. Que es el sistema

El sistema permite a una agencia de viajes:

- Tener una **base de datos de pasajeros** con su documentacion: DNI, pasaporte argentino, pasaporte extranjero, visas, asistencias medicas y programas de viajero frecuente.
- **Leer los documentos de forma automatizada**: subis una foto del pasaporte, DNI, visa o Excel y el sistema completa los datos del pasajero solo y sin errores (Las imagenes no se guardan).
- **Generar los strings SSR/FOID** listos para copiar y pegar en el GDS (Amadeus o Sabre).
- **Controlar los check-ins**: cargas la reserva con el PNR o el e-ticket, y el sistema te avisa cuando un vuelo esta por salir sin check-in hecho.
- **Recibir alertas de vencimiento** de documentos y cumpleanos de pasajeros.
- **Consultar los requisitos de vuelo** (visas, eTA, tasas, vacunas, paradas tecnicas) por nacionalidad y ruta, vuelo, Cia aerea. Podes pegar el GDS o adjuntar el itinerario en PDF o en foto.


---

## 2. Requisitos para usar el sistema

- Una computadora, tablet o celular con conexion a internet.
- Un navegador moderno (Chrome, Edge, Firefox o Safari actualizados).
- Una cuenta de usuario creada por el administrador de tu agencia (email y contrasena).
- Para el doble factor: un celular con una aplicacion de autenticacion (por ejemplo Google Authenticator, que se descarga gratis de la tienda de aplicaciones).

---

## 3. Ingreso al sistema (login)

1. Abri el navegador y entra a traveldocs.com.ar/login.html
2. Se abre la pantalla **"Ingresar a la cuenta"**.
3. Escribi tu **Email** en el primer campo.
4. Escribi tu **Contrasena** en el segundo campo.
5. Hace click en el boton **Ingresar**.

Que pasa despues:

- Si es la **primera vez** que entras, el sistema te va a pedir activar el doble factor de seguridad (ver seccion 4).
- Si ya activaste el doble factor, te pide el codigo de 6 digitos del autenticador:
  1. Abri la aplicacion de autenticador en tu celular.
  2. Busca el codigo de **6 digitos de TravelDocs** que muestra para tu cuenta (cambia cada 30 segundos).
  3. Escribilo en el campo **"Codigo de 6 digitos"**.
  4. Hace click en **Validar**.
- Si el email o la contrasena son incorrectos, aparece un mensaje de error en rojo arriba del formulario. Corrigi los datos y vuelve a intentar.

> Si ves el mensaje "Tu cuenta no esta autorizada", tu usuario todavia no fue habilitado o fue desactivado. Contacta al administrador de tu agencia.

---

## 4. Primer ingreso: activacion del doble factor de seguridad

La primera vez que entras, el sistema te obliga a activar el doble factor. Es un paso unico, luego no se repite.

### Paso 1: escanear el codigo QR

1. Al ingresar por primera vez, el sistema muestra la pantalla de configuracion con un **codigo QR**.
2. En tu celular, abri la aplicacion de autenticacion (por ejemplo Google Authenticator).
3. En la aplicacion, elegi agregar una nueva cuenta y escanea el codigo QR que ves en pantalla.

### Paso 2: confirmar el codigo

1. La aplicacion del celular empieza a mostrar un codigo de 6 digitos para tu cuenta.
2. Escribi ese codigo en el campo **"Codigo de 6 digitos que genero la app"**.
3. Hace click en **Activar autenticador**.

### Paso 3: guardar el codigo de recuperacion (MUY IMPORTANTE)

Si el codigo es correcto, el sistema muestra **una sola vez** tu **codigo de recuperacion**.

- Ese codigo es la unica forma de recuperar tu acceso si perdes el celular o desinstalas la aplicacion por error.
- El sistema nunca lo vuelve a mostrar y nadie puede consultarlo por vos.

Hace esto SI o SI:

1. Sacale una **foto a la pantalla**, copialo en un administrador de contrasenas, o anotalo en papel y guardalo en un lugar seguro.
2. Si queres tenerlo en el portapapeles, hace click en **Copiar codigo**.
3. Cuando estes seguro de que lo guardaste, hace click en **Lo guarde, continuar**.

A partir de aca ya entraste al sistema. En cada ingreso futuro vas a necesitar: email + contrasena + codigo del autenticador.

> Si perdes el telefono y no guardaste el codigo de recuperacion, un administrador de tu agencia puede resetearte el acceso (ver seccion 13). Si guardaste el codigo, daloselo al administrador cuando te lo pida.

---

## 5. Recorrido de la pantalla principal

Al entrar ves dos zonas: la **barra lateral** (izquierda) y el **area de trabajo** (derecha).

### Barra lateral (menu)

Cada boton del menu te lleva a una seccion del sistema:

| Boton | Para que sirve |
|---|---|
| **Dashboard** | Resumen general: numeros, alertas urgentes y check-ins proximos |
| **Pasajeros** | Lista completa de pasajeros de la agencia. Crear, editar, eliminar y filtrar. |
| **Check ins** | Reservas cargadas. Ver, crear y marcar check-ins |
| **Documentos** | Todos los documentos (DNI, pasaportes, visas, asistencias) en una sola tabla |
| **Alertas** | Documentos vencidos, por vencer y cumpleanos proximos |
| **Importar masivo** | Cargar muchos pasajeros de una vez (carpeta de imagenes o Excel/CSV) |
| **Requisitos de Vuelo** | Consulta de visas, eTA, vacunas y otros requisitos por ruta y nacionalidad. Tambien lee un itinerario en PDF o en foto |
| **Seguridad** | Estado de tu doble factor y gestion del equipo |
| **Ciudades** | Codigos de ciudad de tus consolidadores (Amadeus y Sabre), para copiar al armar el PNR |


Dos detalles utiles:

- Al lado de **Check ins** puede aparecer un numero en un circulo: es la cantidad de check-ins pendientes para hoy o manana.
- Al lado de **Alertas** puede aparecer un numero en un circulo rojo: cantidad de alertas urgentes (documentos vencidos o criticos).

### Barra superior

- A la izquierda esta el **titulo de la seccion** en la que estas (cambia segun el boton del menu que tocaste).
- En el centro/derecha esta el **buscador** con el texto "Buscar pasajero...". Lo que escribas ahi filtra la lista de pasajeros por apellido, nombre, numero de documento o palabras claves para asociar familias en la celda notas.
- Mas a la derecha, el boton azul **Nuevo pasajero**: abre el formulario para crear un pasajero desde cualquier seccion.
- En celulares, la barra lateral se esconde y se abre con el boton de **tres rayitas** (menu hamburguesa) de la izquierda.

### Pie de la barra lateral

Abajo a la izquierda ves tu email y tu inicial. Al lado esta el boton de **salida** (icono de flecha) para cerrar sesion (ver seccion 15).

---

## 6. Dashboard

![Dashboard](imagenes/Dashboard.png)

El Dashboard es la pantalla de inicio. Te da una foto del estado general de la agencia.

### Tarjetas de numeros (arriba)

| Tarjeta | Significado |
|---|---|
| **Total pasajeros** | Cantidad de pasajeros en la base de datos de tu agencia |
| **Documentacion OK** | Pasajeros con todos sus documentos vigentes |
| **Por vencer (90d)** | Pasajeros con algun documento que vence en los proximos 90 dias |
| **Vencidos / Criticos** | Pasajeros con documentos vencidos o que vencen en menos de 30 dias. Requiere accion urgente |

### Ultimas alertas (izquierda)

Lista las alertas mas urgentes: documentos vencidos, criticos o cumpleanos en los proximos dias. Tambien puede aparecer un viaje de los proximos 30 dias, con la pastilla "Verifique los requisitos". El click abre el check-in. Un vuelo dentro de Argentina con pasajeros argentinos no entra en esa lista.

- Hace click sobre una alerta para abrir el **detalle del pasajero**.
- Hace click en **Eliminar** para quitar esa alerta de tu vista (el pasajero NO se borra; ver seccion 10).
- Hace click en **Ver todos** (arriba a la derecha de la tarjeta) para ir a la seccion Alertas.

### Ultimos pasajeros (derecha)

Los 5 pasajeros agregados o modificados ultimamente, con su estado general (OK / Atencion / Urgente).

- Hace click sobre una fila para abrir el detalle del pasajero.
- Hace click en **Ver todos** para ir a la seccion Pasajeros.

### Check-ins para hoy y manana (abajo)

Tarjeta con los tramos que salen hoy o manana y todavia no tienen el check-in hecho.

- Hace click sobre uno para abrir la ficha de lectura de ese check-in (codigos de aerolinea, tramos y pasajeros). Desde ahi podes editarlo si hace falta.
- Hace click en **Ver todos** para ir a la seccion Check ins.

---

## 7. Pasajeros

### 7.1 Ver y buscar pasajeros

![Lista de pasajeros](imagenes/Pasajeros%20final.png)

1. Hace click en **Pasajeros** en la barra lateral.
2. Ves la tabla con todos los pasajeros de tu agencia. Cada fila muestra: pasajero, fecha de nacimiento, DNI (con su estado), pasaporte argentino (con su estado), pasaporte extranjero, visas y estado general.
3. Para **buscar**, escribi el apellido, nombre o numero de documento en el buscador **"Buscar pasajero..."** de la barra superior. La tabla se filtra sola mientras escribis.
4. Para **filtrar por estado**, usa la lista desplegable que esta arriba de la tabla, a la izquierda del boton "+ Nuevo pasajero":
   - **Todos**: sin filtro.
   - **Documentacion OK**: solo pasajeros con todo vigente.
   - **Por vencer**: documentos que vencen entre 31 y 90 dias.
   - **Vencidos / Criticos**: vencidos o por vencer en 30 dias o menos.
5. Hace click sobre cualquier **fila** para abrir el detalle del pasajero (seccion 7.4).

### 7.2 Crear un pasajero a mano

![Carga de nuevo pasajero](imagenes/CARGA%20NUEVO%20PASAJERO%201.png)

1. Hace click en el boton azul **"+ Nuevo pasajero"** (arriba a la derecha de la seccion Pasajeros, o en la barra superior desde cualquier seccion).
2. Se abre la ventana **"Nuevo pasajero"**. Es un formulario largo con secciones; solo tres campos son obligatorios.

**Datos personales** (obligatorios):

- **Apellido** (obligatorio). Se guarda siempre en MAYUSCULAS, sin acentos.
- **Nombre** (obligatorio). Igual: MAYUSCULAS sin acentos.
- **Fecha de nacimiento** (obligatorio). Hace click en el campo y elegi la fecha.
- **Sexo**: Masculino o Femenino.
- **Nacionalidad**: desplegable con todos los paises, nombre y codigo de tres letras (por ejemplo Argentina, ARG).
- **CUIT/CUIL**, **Email de contacto** y **WhatsApp**: opcionales, pero se usan para mandarle mails al pasajero desde la seccion Alertas.
- **Observaciones**: notas libres (cliente VIP, infante asociado, preferencias, etc.).

**DNI Argentino**: Numero, Fecha emision y Fecha vencimiento.

**Pasaporte Argentino**: Numero (ej: AAI204554), Fecha emision y Fecha vencimiento.

**Pasaporte Extranjero** (para pasajeros con doble nacionalidad):

- **Apellido y Nombre en este pasaporte**: a veces difieren del nombre en argentino, por eso se cargan aparte.
- **Pais emisor**: desplegable con todos los paises. Si escaneas un pasaporte belga, queda Belgica (BEL).
- Numero, Fecha emision y Fecha vencimiento.

**Visa**:

1. Hace click en el boton **Agregar** de la seccion Visa.
2. Se abre una fila con los campos: Pais destino (3 letras, ej: USA), Numero, Lugar de emision, Tipo (T Turista / B Business / S Student / I Inmigrante / E ESTA), Pasaporte asociado, Fecha emision y Fecha vencimiento.
3. Para agregar otra visa, hace click de nuevo en **Agregar**.
4. Para quitar una visa, hace click en la **X** de su fila.

**Asistencia Medica**: mismo mecanismo que las visas. Boton **Agregar** y completas: Compania aseguradora (ej: ASSIST CARD), Numero de voucher, Fecha inicio, Fecha fin, Duracion (se calcula sola desde las fechas), Producto (ej: AC300) y Cobertura (ej: USD 300.000).

**Viajero Frecuente**: boton **Agregar** y completas la Aerolinea (codigo de 2 letras, ej: AA) y el Numero de programa. Al escribir el codigo de aerolinea, el sistema muestra el nombre del programa (ej: "AA - AAdvantage (American Airlines)") para confirmar que escribiste el codigo correcto.

3. Cuando terminaste, hace click en **Guardar pasajero** (abajo a la derecha de la ventana).

Si falta algun dato obligatorio, aparece el aviso "Completá apellido, nombre y fecha de nacimiento" y no guarda hasta completarlo.

**Control de duplicados**: si ya existe un pasajero con el mismo DNI, el mismo pasaporte o el mismo nombre + fecha de nacimiento, el sistema te avisa con el nombre del pasajero existente y no guarda. Revisa si ese pasajero ya esta cargado y edita ese en lugar de crear uno nuevo.

### 7.3 Crear un pasajero leyendo el documento (escaneo)

Podes omitir la carga a mano: subis una foto del documento y el sistema completa los datos solo.

1. Hace click en **"+ Nuevo pasajero"**.
2. En la primera seccion del formulario, **"Leer documento con OCR (opcional)"**, hace click sobre el recuadro punteado (o arrastra la imagen desde tu computadora hacia el recuadro).
3. Se abre el explorador de archivos. Selecciona una o varias imagenes o PDFs del documento del pasajero:
   - Formatos aceptados: JPG, PNG, WebP, GIF y PDF.
   - Tamano maximo: 20 MB por archivo.
   - Podes subir **varios documentos a la vez** del mismo pasajero: por ejemplo DNI + pasaporte + visa. El sistema los une todos en la misma ficha.
   - Una captura de viajero frecuente, de cualquier aerolinea, completa solo esa seccion: codigo de aerolinea y numero de programa. El resto de la ficha queda como esta.
4. Espera mientras se procesan los archivos. Arriba del recuadro aparece una animacion de pasaporte con el avance. Si subis varios, se procesan de a uno (hay una pausa de unos segundos entre archivo y archivo).
5. Al terminar, el formulario se completa solo con los datos leidos y aparece el mensaje "N documento(s) del pasajero base procesado(s)".

Detalles importantes del escaneo:

- **Si subis documentos de varias personas mezclados**, el sistema detecta que son pasajeros distintos: completa la ficha con el primero y muestra el aviso "Se detectaron N pasajero(s) distinto(s) en M archivo(s)". Con el boton **"Agregar N pasajero(s) detectado(s)"** podes darlos de alta a todos de una vez. Los que ya existen en la base se omiten.
- **Si escaneas sobre un pasajero existente** (editandolo), el sistema pregunta antes de sobrescribir un dato que ya tenia valor cargado: confirma campo por campo que queres reemplazar.
- **Revisa siempre** los datos leidos antes de guardar: corregi cualquier error de lectura en los campos del formulario (los campos quedan editables).
6. Completa lo que falte (los tres campos obligatorios son apellido, nombre y fecha de nacimiento) y hace click en **Guardar pasajero**.

### 7.4 Ver el detalle de un pasajero

1. Hace click sobre la fila del pasajero en la tabla (o sobre su nombre en Dashboard/Alertas).
2. Se abre la ventana de detalle con:

**Columna izquierda**: nombre, estado general de su documentacion, fecha de nacimiento, edad, sexo, nacionalidad, email, WhatsApp y observaciones.

**Columna derecha**:

- Una **tarjeta por cada documento** cargado (DNI, pasaporte ARG, pasaporte extranjero, visas, asistencias) con: numero, fecha de emision, fecha de vencimiento, cuantos dias le quedan y el semaforo de estado.
- La seccion **Strings SSR** (seccion 7.5).

### 7.5 Strings SSR para el GDS

En el detalle del pasajero, abajo, esta la tarjeta **"Strings SSR"**. Ahi el sistema arma automaticamente los comandos listos para pegar en el GDS, segun la documentacion cargada del pasajero.

1. En el desplegable **GDS** (arriba a la derecha de la tarjeta) elegi tu sistema: **Amadeus** o **Sabre**. La lista de strings se regenera al instante para el formato elegido, y el sistema recuerda tu eleccion para la proxima vez.
2. La lista muestra un string por cada dato disponible. Por ejemplo, para un pasajero con pasaporte argentino, DNI, visa de USA, email y celular:
   - **NM** con el nombre completo (formato GDS).
   - **SRDOCS / DOCS** del pasaporte argentino.
   - **SRDOCS / DOCS** del pasaporte extranjero (si tiene).
   - **SRDOCS corto** (solo nombre).
   - **SRDOCS / DOCS** del DNI y **SRFOID** del DNI.
   - **SRDOCO / DOCO** de cada visa.
   - **SRCTCE / CTCE** con el email codificado para GDS (guiones bajos y medios se codifican segun estandar IATA).
   - **SRCTCM / CTCM** con el celular.
   - **FSR** con el CUIT/CUIL.
   - **FFN** de cada programa de viajero frecuente.
3. Hace click en **copiar** (boton a la derecha de cada string) y pegalo directamente en el GDS.

> Los formatos SSR/FOID son estandares IATA: no se modifican. Si un string sale mal, revisa que los datos del pasajero esten bien cargados.

### 7.6 Editar un pasajero

1. En la tabla de Pasajeros, hace click en el **icono de lapiz** de la fila del pasajero (ultima columna), o abri el detalle y hace click en **Editar**.
2. Se abre el mismo formulario de carga, ya completado con los datos actuales.
3. Modifica lo que necesites y hace click en **Guardar pasajero**.

### 7.7 Eliminar un pasajero

1. En la tabla de Pasajeros, hace click en el boton rojo **Eliminar** de la fila del pasajero.
2. Se abre una ventana de confirmacion: "Estas por eliminar a [nombre] de la base de datos. Estas seguro?".
3. Hace click en **"Si, eliminar pasajero"** para confirmar, o en **Cancelar** si te equivocaste.

> Ojo: eliminar un pasajero borra todos sus datos y no se puede deshacer.

---

## 8. Check ins

Esta seccion lleva el control de las reservas y sus check-ins. Cada reserva puede tener uno o varios **tramos** (por ejemplo: ida EZE-MAD y vuelta MAD-EZE), y cada tramo tiene su propio check-in.

### 8.1 Crear un check-in pegando el PNR

![Creacion de check-ins](imagenes/Creacion%20de%20Check%20Ins.png)

Esta es la forma mas rapida. El sistema lee el PNR pegado y completa el formulario solo.

1. En la barra lateral, hace click en la pestana **Check ins**.
2. Arriba a la derecha, hace click en el boton azul **"+ Nuevo check-in"**.
3. Se abre la ventana **"Nuevo check-in"**. En el campo grande de la seccion **"Pegar PNR o adjuntar e-ticket"** (con el titulo "Copia el PNR del GDS"), pega el texto del PNR copiado del GDS (Sabre o Amadeus). El texto tiene que incluir:
   - Las **lineas con los nombres de los pasajeros** (formato APELLIDO/NOMBRE).
   - Las **lineas de los vuelos** (numero de vuelo, fechas, ciudades, horarios).
4. Hace click en el boton **"Decodificar PNR"**.
5. Espera unos segundos mientras el sistema procesa el PNR. Al terminar, aparecen en verde el mensaje "PNR interpretado. Revisá los datos antes de guardar." y un cuadro de resumen con:
   - **"N pasajero(s) · M asociado(s) a la base"**: cuantos pasajeros tenia el PNR y cuantos encontro ya cargados en tu base de Pasajeros. Los encontrados quedan **agregados automaticamente** al check-in.
   - Si hay pasajeros del PNR que NO estan en la base, se listan en rojo: "No encontrados en la base (darlos de alta en Pasajeros)". Para esos: cancela este check-in, cargalos primero en la seccion Pasajeros (seccion 7) y volve a crear el check-in, o agregalos a mano con el buscador (paso 8).
   - Los **tramos del viaje**, ya cargados en la seccion "Datos del vuelo" con: numero de vuelo, origen, destino, escalas, fecha y hora de salida (en horario Argentina).
   - La **reserva de aerolinea para el check-in web** (el codigo de la CIA, por tramo si hay mas de una).
6. **Revisa que los datos esten bien**: corregi en cada tramo lo que haga falta (los campos son editables):
   - **Vuelo**: numero (ej: IB110).
   - **Origen** y **Destino**: codigos IATA de 3 letras (ej: EZE, MAD).
   - **Escalas (IATA, coma)**: si el tramo tiene escalas, escribilas separadas por coma (ej: GRU,SCL). Si no tiene, deja el campo vacio.
   - **Salida**: fecha y hora de salida del vuelo (obligatorio; los tramos sin fecha no se guardan).
   - **Check-in**: Sí o No, si ya le hiciste el check-in a ese tramo.
   - Para quitar un tramo sobrante, hace click en la **X** de la fila del tramo. Para agregar otro a mano, hace click en **"+ Agregar tramo"**.
7. En la seccion **"Datos del vuelo"**, arriba de los tramos, revisa:
   - **Reserva aerolinea (check-in web)**: el codigo que usa la aerolinea para el check-in por internet (ej: KRBJJ). Es el que copias en la web de AA, IB, AR, etc. No se muestra el record locator del GDS para no mezclarlo con este codigo.
   - **Compania aerea** (obligatorio): el codigo de la aerolinea (ej: AA, AR, LA, IB). Al escribirlo, abajo aparece el nombre de la aerolinea (ej: "AA - American Airlines") para que confirmes que es el correcto.
   - Si el itinerario tiene tramos de **aerolineas distintas**, esas dos casillas de arriba desaparecen y el aviso "Itinerario multi-aerolinea: completá la aerolinea y el código de reserva de cada tramo" te pide completar la aerolinea y el codigo de reserva **dentro de cada tramo**.
8. En la seccion **"Pasajeros"**:
   - Los pasajeros reconocidos ya quedaron agregados (los ves listados arriba).
   - Para agregar otro pasajero, escribi su apellido o nombre en **"Buscar pasajero para agregar..."** y hace click sobre el resultado (aparece un + a la derecha). Podes agregar todos los que viajen juntos.
   - Para quitar un pasajero, hace click en **Quitar** junto a su nombre.
9. En la sección **"Aviso de check-in"** (opcional):
   - **Email para el aviso**: si el aviso de este check-in tiene que llegar a otro email (por ejemplo, el del pasajero), escribilo acá. Vacío = se usa el email de alertas de la agencia.
   - **Avisar con anticipación**: con cuánta anticipación querés el aviso: **24 horas** antes (día previo, lo normal), **48 horas** (2 días) o **72 horas** (3 días).
10. Hace click en **"Guardar check-in"** (abajo a la derecha).

El sistema valida antes de guardar:

- Que haya **al menos un tramo con fecha**.
- Que **todos los tramos tengan compania aerea**.
- Que el viaje **no este duplicado**: si el mismo pasajero ya tiene cargado el mismo vuelo en la misma fecha en otro check-in, avisa "Ese viaje ya está cargado para..." y no guarda (evita alertas repetidas).

Si todo esta bien, aparece "Check-in creado" y el check-in queda en la lista. En ese momento sale el mail de requisitos del destino (seccion 8.7). Editar un check-in que ya existia no lo vuelve a mandar.

### 8.2 Crear un check-in adjuntando el e-ticket

Alternativa al pegado del PNR: subis el e-ticket en PDF y el sistema lo lee solo.

1. Hace click en **Check ins** en la barra lateral.
2. Hace click en **"+ Nuevo check-in"**.
3. En la seccion **"Pegar PNR o adjuntar e-ticket"**, hace click en el boton **"Adjuntar e-ticket PDF"**.
4. Selecciona el archivo PDF del e-ticket o itinerario. Podes elegir **varios a la vez** (por ejemplo, uno por pasajero cuando cada uno tiene el suyo). Limites: PDF de hasta 2 MB cada uno, maximo 8 archivos, y entre todos no mas de 4 MB.
5. El sistema los procesa automaticamente y completa el formulario igual que con el PNR: tramos, aerolinea, **codigo de reserva de cada CIA** y busqueda de pasajeros en la base. Si el itinerario tiene mas de una aerolinea, cada tramo queda con su codigo.
6. Segui desde el paso 6 de la seccion 8.1: revisa los datos, completa lo que falte y hace click en **"Guardar check-in"**.

> Los PDF se leen una sola vez para extraer los datos. No quedan guardados ni adjuntos al check-in.

### 8.3 Crear un check-in a mano (sin PNR ni e-ticket)

1. Hace click en **Check ins** -> **"+ Nuevo check-in"**.
2. Deja el campo del PNR vacio y completa a mano:
   - **Reserva aerolinea (check-in web)** y **Compania aerea**.
   - Hace click en **"+ Agregar tramo"** y completa: vuelo, origen, destino, escalas, fecha/hora de salida. Agrega un tramo por cada vuelo del viaje (ida y vuelta son dos tramos).
3. Agrega los pasajeros con el buscador de la seccion Pasajeros.
4. Hace click en **"Guardar check-in"**.

### 8.4 La lista de check-ins

![Lista de check-ins](imagenes/Check%20ins.png)

Cada check-in de la lista muestra:

- **Apellidos de los pasajeros**, aerolinea y codigo de check-in web (el de la CIA).
- Los **tramos** con su ruta y fecha (ej: "EZE→MAD 08 jul 08:45hs · MAD→EZE 29 jul 16:05hs") y la cantidad de pasajeros.
- Una **etiqueta de color por tramo**:
  - Verde con un check: check-in ya hecho.
  - Rojo "pronto": el vuelo sale hoy o manana y no tiene check-in hecho.
  - Azul "pasado": vuelo ya realizado.
  - Amarillo: vuelo futuro.
- Botones de accion a la derecha:
  - **"[Ruta]: Check-in"**: marca el check-in de ese tramo como hecho. Una vez marcado, el mismo boton dice **"Desmarcar"** para volver atras.
  - **Editar**: abre el formulario para modificar tramos, codigos o pasajeros.
  - **Eliminar** (en rojo): borra el check-in (pide confirmacion).
- El buscador de arriba de la lista filtra los check-ins por nombre o apellido del pasajero.

Los check-ins viejos se limpian solos: cuando todos los tramos de un viaje ya volaron, el check-in se borra de la lista al día siguiente (un vuelo del 10 de octubre desaparece el 11). No hace falta eliminarlos a mano.

Hace click en la **tarjeta** (no en esos botones) para abrir la ficha de lectura. Ver seccion 8.5.

### 8.5 Ver un check-in (ficha de lectura)

1. Hace click sobre la tarjeta del check-in en la lista, o sobre un item de **"Check-ins para hoy y manana"** en el Dashboard.
2. Se abre una ventana de **solo lectura** (no el formulario de carga). Ahi ves:
   - Los **codigos de reserva por CIA**, cada uno con su aerolinea y un boton **copiar**. Si hay una sola aerolinea y un solo codigo, aparece una vez (no se repite en cada tramo). Si hay varias (por ejemplo AF e IB), cada codigo queda junto a su CIA y tambien en el tramo que le corresponde.
   - Los **tramos**: ruta, numero de vuelo, fecha y si el check-in de ese tramo ya esta hecho.
   - Los **pasajeros**, con nombre y fecha de nacimiento. Abajo del titulo dice "Toca un nombre para abrir la ficha".
   - El **aviso**: a qué email va el recordatorio y con cuánta anticipación está configurado (24, 48 o 72 horas).
3. Hace click en un **pasajero** para ver su ficha: datos personales, documentos y vencimientos. Desde aca **no** se edita, **no** se copian strings SSR y **no** hay boton de copiar: es para consultar (nacimiento, pasaporte, etc.) y volver al check-in. Cerra esa ventana y segui en la ficha del viaje.
4. Si hay que modificar algo del viaje, hace click en **Editar** (arriba de la ficha o en la lista). Ahi si esta el formulario: PNR del GDS para decodificar, PDF, tramos y pasajeros.
5. Para marcar el check-in de un tramo como hecho no hace falta abrir la ficha: usa el boton de la lista.

### 8.6 Avisos de check-in pendiente

- En la barra lateral, el numero junto a **Check ins** indica cuantos tramos salen hoy o manana sin check-in hecho.
- En el Dashboard, la tarjeta **"Check-ins para hoy y manana"** los lista.
- Los avisos por email salen solos, una sola vez por tramo, de dos formas:
  - Todos los días a las **9 de la mañana** llega un email a la direccion de alertas de la agencia con los check-ins pendientes, aunque nadie haya abierto el sistema.
  - Si alguien de la agencia entra al sistema dentro del plazo de aviso de un vuelo (según la anticipación elegida al crearlo: 24, 48 o 72 horas antes de la salida), el aviso de ese vuelo sale en ese momento, sin esperar a las 9.

### 8.7 Mail de requisitos al crear el check-in

Al guardar un check-in nuevo sale un mail con los tramos, los pasajeros y los requisitos de visa y sanidad. El formato es el de los otros avisos: fondo crema, el nombre de la agencia y la fecha. Dice Pasajera o Pasajero según el sexo cargado en la ficha, y "Usted tiene" con los pasaportes. Si dos personas comparten destino y pasaporte, el texto de visa y de sanidad sale una sola vez. Los paises con el mismo texto se juntan. El titulo dice "Destino" si es uno y "Destinos" si son mas. La vuelta a un pais que la base no tiene, como Argentina, no aparece. Con un solo pais el asunto dice "para este destino". Con varios, "para estos destinos".

El mail va al email cargado en el check-in. Si ese campo esta vacio, va al de alertas de la agencia, igual que el aviso de 24, 48 o 72 horas.

Sale al guardar. Si en ese momento faltan mas de 30 dias, el mail avisa que vuelve a llegar 30 dias antes de la salida, y sale de nuevo cuando el viaje entra en esos 30 dias, sin esa frase. Si al guardarlo ya faltan 30 dias o menos, queda ese unico mail. El aviso de 24, 48 o 72 horas es otro mail y sigue igual.

Un vuelo dentro de Argentina, con todos los pasajeros argentinos en la ficha, no manda ese mail: alcanza el DNI. Si hay un pasajero con otra nacionalidad, por ejemplo Australia, el mail sale y dice que ese pasajero viaja con pasaporte.

A las 9 de la manana sale el mail de los 30 dias. Si al guardar no pudo salir, esa corrida lo manda cuando al viaje le faltan 30 dias o menos.

---

## 9. Documentos

Vista unificada de todos los documentos de todos los pasajeros.

1. Hace click en **Documentos** en la barra lateral.
2. Arriba hay pestanas de filtro rapido: **Todos**, **DNI**, **Pasaporte ARG**, **Pas. Extranjero**, **Visas**, **Asistencias Medicas**. Hace click en una para ver solo ese tipo.
3. La tabla lista cada documento con: pasajero, tipo, pais, numero, fecha de emision, fecha de vencimiento y estado (semaforo).
4. La tabla esta **ordenada por vencimiento**: los documentos que vencen primero (o ya vencieron) aparecen arriba. Es util para detectar urgencias de un vistazo.
5. Hace click sobre una fila para abrir el detalle del pasajero dueño del documento.

---

## 10. Alertas de vencimiento

![Alertas de vencimiento](imagenes/Alertas%20de%20Vencimiento.png)

1. Hace click en **Alertas** en la barra lateral.
2. La pantalla esta organizada en bloques, de mas urgente a menos:

| Bloque | Que contiene |
|---|---|
| **Vencidos y criticos (0-30 dias)** (rojo) | Documentos vencidos o que vencen en el proximo mes. Accion inmediata |
| **Por vencer (31-90 dias)** (amarillo) | Documentos que vencen en los proximos 3 meses |
| **DNI, Visas y Pasaporte - Vencen en 6 meses (91-180 dias)** (azul) | Documentos a renovar con tiempo. Incluye el boton **"Notificar a todos por email"** |
| **Cumpleanos proximos (30 dias)** (violeta) | Cumpleanos de pasajeros en el proximo mes |
| **Viajes a verificar requisitos migratorios y sanitarios (30 dias)** (azul) | Check-ins que salen dentro de 30 dias. El click abre el check-in, no la ficha del pasajero. Un vuelo dentro de Argentina con pasajeros argentinos no aparece. Si la lista pasa de cinco, abajo dice **Ver todos** |

Acciones disponibles en cada alerta:

- **Click sobre la alerta**: abre el detalle del pasajero.
- **Icono de sobre (mail)**: si el pasajero tiene email cargado, abre tu programa de correo con un mail ya redactado para pedirle la renovacion (o felicitarlo, si es cumpleanos). Revisalo y envialo.
- **Boton "Notificar a todos por email"** (solo bloque de 6 meses): abre tu correo con un unico mail para todos los pasajeros del bloque, con el detalle de cada documento por vencer.
- **Boton "Eliminar"**: quita esa alerta de TU vista. Pide confirmacion. Importante: la alerta se elimina solo para vos (cada agente maneja sus alertas vistas); el pasajero y sus documentos no se tocan.

> Los emails de renovacion y los avisos de check-in se envian desde tu propio correo cuando usas los botones de mail; el sistema los deja redactados listos para enviar.
>
> Ademas, todos los dias a las 9 de la manana el sistema envia un email a la direccion de alertas de la agencia con los vencimientos, los check-ins pendientes y los cumpleanos del dia, aunque nadie haya abierto el sistema. Si alguien entra antes, ese dia el email sale en ese momento. El cumpleanos entra en ese mail solo si es hoy. El mail de requisitos del destino sale al crear el check-in y otra vez a las 9 cuando el viaje entra en los 30 dias (seccion 8.7). Si el check-in se creo ya dentro de esos 30 dias, no se repite.

---

## 11. Importacion masiva

![Importacion masiva](imagenes/Importacion%20Masiva.png)

Para cargar muchos pasajeros de una sola vez, sin cargarlos de a uno. Hay dos formas: carpeta de imagenes o planilla Excel/CSV.

### 11.1 Desde una carpeta de imagenes

Ideal cuando tenes fotos, escaneos o PDF de pasaportes y visas de muchos pasajeros.

1. Hace click en **Importar masivo** en la barra lateral.
2. Hace click sobre el recuadro **"Selecciona la carpeta de documentos"**, o arrastra las imagenes y los PDF al recuadro.
3. Requisitos:
   - Imagenes: JPG, PNG o WebP. Maximo 4 MB por imagen.
   - PDF: maximo 20 MB por archivo.
   - Podes meter en la misma carpeta documentos de varios pasajeros distintos: el sistema los agrupa solo por persona.
4. Empieza el procesamiento: veras una barra de progreso con el nombre del archivo que esta leyendo y el contador (ej: "12 / 40"). Un tip: el proceso lee cada archivo en orden, asi que las carpetas grandes pueden tardar varios minutos. No cierres la pagina.
5. Al terminar aparece la tabla **"Revisa los resultados"** con un resumen: "N pasajero(s) detectado(s)". Cada tarjeta muestra:
   - Nombre y fecha de nacimiento detectados. Si falta algun dato obligatorio, aparece en rojo ("Sin apellido", "Sin fecha de nacimiento") y la tarjeta queda marcada con un borde amarillo.
   - Los documentos detectados como etiquetas azules (ej: "Pas. ARG AAI204554", "DNI 39171901", "Visa USA 17317323").
   - Los archivos de donde salieron esos datos.
   - Si el pasajero **ya existe** en la base, la tarjeta queda gris con la marca "Ya existe - se omitira".
   - Boton **X** para quitar de la lista un pasajero que no quieras importar.
6. Hace click en **Guardar todos**. El sistema crea todos los pasajeros nuevos de una vez y salta los duplicados.
7. Aparece el resumen del resultado (ej: "18 importado(s) - 5 ya existian (omitidos)") y el sistema te lleva a la seccion Pasajeros.
8. Si en lugar de guardar queres cancelar todo, hace click en **Cancelar**.

> Los pasajeros importados con datos faltantes (por ejemplo sin fecha de nacimiento) no se guardan. Buscalos en la tabla de revision, completalos despues a mano desde Pasajeros.

### 11.2 Desde Excel / CSV

Para cuando tenes la base en una planilla.

1. Hace click en **Importar masivo**.
2. Hace click en el boton **"Importar desde Excel/CSV"** (esta abajo del recuadro de carpeta).
3. Elegi el archivo `.xlsx`, `.xls` o `.csv`.
4. La planilla tiene que tener una fila de encabezados y (como minimo) estas columnas:

   `APELLIDO | NOMBRE | DNI | VTO DNI | PASAPORTE | VTO PASS | FECHA NAC | CUILS`

   Tambien acepta variantes de nombres de columna (por ejemplo "APELLIDOS", "VENCIMIENTO PASAPORTE", "FECHA DE NACIMIENTO", "CUIT", etc.) y columnas extra de contacto como TELEFONO/CELULAR, DIRECCION, LOCALIDAD, PROVINCIA y CODIGO POSTAL.
5. Al procesarse, aparece la misma tabla de revision que en el punto 11.1: revisa, quita lo que no quieras y hace click en **Guardar todos**.

---

## 12. Requisitos de Vuelo

![Requisitos de Migraciones y Salud](imagenes/Requisitos%20de%20Migraciones%20y%20Salud.png)

Consulta de visas, eTA, tasas de ingreso, vacunas y paradas tecnicas que no figuran en el GDS, para una ruta y una nacionalidad.

1. Hace click en **Requisitos de Vuelo** en la barra lateral.
2. Elegi el modo de consulta con los tres botones de la parte superior:

### Modo "Vuelo individual"

Para consultar un vuelo puntual.

1. Asegurate de que este activo el boton **"Vuelo individual"**.
2. Completa:
   - **Numero de vuelo** (obligatorio): formato aerolinea + numero (ej: MU746, AR1102, AA100).
   - **Origen (IATA)** (obligatorio): codigo de 3 letras del aeropuerto de salida (ej: EZE).
   - **Destino (IATA)** (obligatorio): codigo de 3 letras del aeropuerto de llegada (ej: AUA).

### Modo "Pegar segmentos GDS"

Para itinerarios completos de varios vuelos.

1. Hace click en el boton **"Pegar segmentos GDS"**.
2. En el cuadro de texto grande, pega las lineas de vuelo del itinerario copiadas del GDS (Amadeus, y tambien formatos de Sabre o WorldSpan). Por ejemplo:

   ```
   2  MU 746 R 28APR 2*EZEPVG HK1  0215 1810  29APR  E  CA/QBRHFZ
   3  MU5325 R 29APR 3*PVGCAN HK1  2225 0050  30APR  E  CA/QBRHFZ
   ```

3. En cuanto pegas el texto, abajo aparece el resumen de deteccion: **"N tramos detectados"**, cada uno con su vuelo, origen, destino y fecha. Si no aparece nada, las lineas pegadas no tienen un formato reconocible: copia de nuevo las lineas de vuelo desde el GDS.

### Modo "Itinerario"

Para leer el e-ticket o una foto del itinerario, sin copiar los segmentos.

1. Hace click en el boton **"Itinerario"**.
2. Hace click en **Adjuntar itinerario**, o arrastra el archivo al recuadro. Acepta un PDF o una foto (JPG, PNG, WebP, GIF o HEIC).
3. Si encuentra los vuelos, aparece **"N tramos listos para consultar"**, con vuelo, origen, destino y fecha. Toma hasta 12 tramos. El PDF puede pesar hasta 8 MB y tener hasta 20 paginas. La foto, hasta 20 MB.
4. Si no es un PDF ni una foto, avisa y no lo lee. Si no ve el numero de vuelo, la fecha y los aeropuertos, tambien avisa. En ese caso pega los segmentos en **Pegar segmentos GDS**.

### Consulta (comun a los tres modos)

3. Completa los campos de abajo:
   - **Fecha de viaje**: opcional, ayuda a afinar la vigencia de los requisitos.
   - **Nacionalidad del pasajero** (obligatorio): desplegable con los paises.
4. Hace click en **Consultar requisitos**.
5. La consulta tiene dos etapas: primero "Analizando..." y despues "Verificando requisitos en la web...". Puede tardar hasta un minuto en itinerarios largos. No cierres la pagina.
6. El boton **Limpiar** resetea el formulario para una consulta nueva.

### Leer los resultados

- **Barra superior del vuelo**: numero, aerolinea, ruta completa, duracion aproximada y el nivel de **certeza de la ruta** (alta/media/baja) con el que el sistema pudo reconstruir el vuelo, incluyendo escalas tecnicas que no figuran en el GDS.
- **ALERTAS CRITICAS - Comunicar al pasajero antes de volar**: franja roja con los puntos que hay que avisar si o si (ej: visa obligatoria, formulario de salud, vacuna exigida).
- **Pestanas de paradas**: una pestana por cada punto del viaje (origen, escalas, destino). Cada pestana indica:
  - **"Requisitos"** (rojo): esa parada tiene requisitos que revisar.
  - **"Parada tecnica"**: escala sin cambio de avion; en algunos paises igual exige requisitos de transito.
  - **"Verificar"** (verde): sin requisitos detectados.
  Hace click en cada pestana para ver sus requisitos.
- **Tarjetas de requisito**: dentro de cada parada, cada requisito se muestra con su categoria (VISA, eVISA, eTA, TRANSITO, VACUNA, MEDICACION, PLF, DECLARACION, SEGURO), si es **Obligatorio** o **Recomendado**, su descripcion, costo aproximado, anticipacion recomendada y el link **"Sitio oficial"** para tramitarlo o consultar la fuente.
- Si una parada no exige nada, ves el cartel **"Libre de visa"** (ej: "Pasaporte ARG ingresa sin visa a CHINA").
- Las pestanas no repiten un aeropuerto que ya aparecio. Si el pasajero vuelve al pais de donde salio y ese pais es el suyo, la llegada de vuelta no abre otra ficha. El tramo sigue en la barra del vuelo.

> **Aviso legal**: la informacion es orientativa. Confirma siempre fuentes oficiales del gobierno antes de emitir.

---

## 13. Seguridad (doble factor)

1. Hace click en **Seguridad** en la barra lateral.
2. Arriba ves el estado de tu propia cuenta:
   - **"2FA activo"**: tu cuenta ya usa el autenticador. No tenes que hacer nada.
   - **"2FA pendiente"**: todavia no activaste el autenticador. Cerra sesion y volve a ingresar para que el sistema te guie (seccion 4).

### Gestion del equipo (solo dueño o administrador de la agencia)

Si tu rol es owner, abajo ves **"2FA de los miembros de la agencia"** con la lista de todos los usuarios de tu agencia y el estado de cada uno (activo / pendiente).

- **Refrescar**: actualiza la lista.
- **Resetear**: para el caso de un miembro que perdio el telefono. El sistema te pide **un codigo de recuperacion otorgado por ese miembro** (el que guardo cuando activo su autenticador). Al confirmar, el doble factor del miembro queda desactivado y debera reconfigurarlo en su proximo ingreso. Nunca resetees el 2FA de un miembro sin su pedido y su codigo.

---

## 14. Ciudades

Codigos de ciudad (office ID / PCC) de tus consolidadores en Amadeus y Sabre, para copiar cuando armas el PNR. Cada agencia carga los suyos: los ve todo el equipo.

1. Hace click en **Ciudades** en la barra lateral (debajo de Seguridad).
2. Hace click en **Agregar ciudad**.
3. Completa el **titulo** (ej: Ciudad Ricale), elegi **Amadeus** o **Sabre** en el desplegable y el **codigo**.
4. Hace click en **Guardar**. La ciudad queda fija: titulo, CIA y codigo, con boton **copiar**.
5. **Editar** vuelve a abrir el formulario de esa ciudad. La **x** la quita.

Si hay una sola ciudad de un GDS, igual se carga con Agregar ciudad (ya no hay filas fijas vacias de Amadeus y Sabre).

---

## 15. Cerrar sesion

1. Hace click en el **icono de salida** (flecha) que esta abajo de la barra lateral, al lado de tu email.
2. El sistema cierra tu sesion y vuelve a la pantalla de ingreso.

Consejo: cerrar sesion al terminar el dia es buena practica, especialmente en computadoras compartidas.

---

## 16. Referencia rapida: estados y colores

El sistema usa un semaforo de vencimientos en todas las vistas:

| Estado | Color | Significado |
|---|---|---|
| **Vencido** | Rojo | El documento ya vencio |
| **Critico** | Rojo | Vence en 30 dias o menos (0 a 30) |
| **Por vencer** | Amarillo | Vence entre 31 y 90 dias |
| **Vigente / OK** | Verde | Vence en mas de 90 dias |
| **Sin datos** | Gris | El pasajero no tiene documentos cargados |

Estados de tramos en Check ins:

| Etiqueta | Significado |
|---|---|
| Verde con check | Check-in de ese tramo hecho |
| Rojo "pronto" | Vuelo hoy o manana sin check-in |
| Azul "pasado" | Vuelo ya realizado |
| Amarillo | Vuelo futuro |

---

## 17. Preguntas frecuentes y problemas comunes

**Me dice "Tu cuenta no esta autorizada".**
Tu usuario no existe, esta desactivado, o tu agencia esta suspendida. Contacta al administrador de tu agencia para que revise tu cuenta.

**Me dice "Sesion expirada. Volve a ingresar.".**
Paso mucho tiempo sin actividad. Cerra la sesion, volve a ingresar con email, contrasena y codigo del autenticador.

**Perdi el celular con el autenticador.**
Si guardaste el codigo de recuperacion: pedile a un administrador de tu agencia que use "Resetear" en la seccion Seguridad y dale tu codigo. Si tampoco tenes el codigo, igualmente contactalo: tendra que gestionar el alta nuevamente.

**El PNR no se interpreta / el boton Decodificar PNR da error.**
- Verifica que pegaste el PNR completo: tiene que incluir las lineas de nombres y las lineas de vuelos.
- No pegues lineas de vuelos ya realizados (status FLWN); se ignoran.
- Revisa tu conexion a internet e intenta de nuevo. Si sigue fallando, avisa al administrador de la plataforma.

**El e-ticket PDF no se procesa.**
- Tiene que ser un PDF (no una foto del e-ticket): si tenes la foto, usa mejor el campo del PNR o crealo a mano.
- Limite: 2 MB por PDF, maximo 8 por vez, 4 MB en total.

**En Requisitos de Vuelo no me lee el itinerario.**
Tiene que ser un PDF o una foto, con el numero de vuelo, la fecha y los aeropuertos a la vista. El PDF hasta 8 MB y 20 paginas. La foto hasta 20 MB. Si igual no lo toma, pega los segmentos en Pegar segmentos GDS.

**En la ficha del check-in no veo el PNR del GDS.**
Es a proposito: ahi se muestran los **codigos de la CIA** (los del check-in web). El PNR de Amadeus o Sabre se usa al crear o editar (pegar y decodificar), no en la ficha de lectura.

**Pegue un PNR y algunos pasajeros figuran "No encontrados en la base".**
Esos pasajeros no estan cargados en tu base de Pasajeros. Dalos de alta primero (a mano o con el escaneo del documento, seccion 7) y despues agregalos al check-in con el buscador, o volve a decodificar el PNR.

**No quiero crear el mismo check-in dos veces.**
No hace falta: el sistema bloquea los duplicados (mismo pasajero + mismo vuelo + misma fecha) automaticamente.

**No me llego el email de check-in / de vencimiento.**
Los avisos automaticos salen todos los dias a las 9 de la manana (vencimientos, check-ins pendientes y cumpleanos del dia), aunque nadie abra el sistema. Si alguien de la agencia entra dentro de las horas previas a un vuelo, el aviso de ese check-in sale en ese momento. El mail de requisitos del destino sale al guardar el check-in nuevo, y otra vez cuando faltan 30 dias si el viaje estaba mas lejos. Si al crearlo ya faltaban 30 dias o menos, queda un solo mail. Si igual no llega, avisa al administrador para revisar la direccion de alertas de la agencia.

**Elimine una alerta por error.**
La alerta se elimino solo de tu vista. Si volves a entrar con otro usuario (o el administrador revisa), la alerta sigue apareciendo para los demas. No hay forma de restaurarla en tu usuario, pero el dato siempre lo ves en la seccion Documentos.

**El escaneo de un documento cargo mal un dato.**
Los campos quedan editables despues del escaneo: corregilo a mano antes de guardar. La lectura es automatica y puede equivocarse con fotos borrosas o con luz mala; usa fotos nítidas y sin reflejos.

**Los strings SSR no aparecen en el detalle del pasajero.**
Solo se generan los strings de los datos cargados. Si el pasajero no tiene pasaporte, DNI ni visa cargados, la lista aparece vacia ("Sin documentos cargados"). Completa su documentacion primero.

**Otros usuarios de mi agencia ven pasajeros distintos a los mios.**
No deberia pasar: todos los usuarios de una agencia ven la misma base. Las unicas vistas personales son las alertas que cada uno elimino. Si ves bases distintas, avisa al administrador.

**Puedo estar en dos agencias con el mismo usuario?**
No. Cada usuario pertenece a una sola agencia.

---

*Manual del usuario - version 1 (agosto 2026).*
