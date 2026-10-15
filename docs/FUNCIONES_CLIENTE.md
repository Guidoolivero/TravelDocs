# DocTravel - Funciones para Cliente

## Que hace el sistema

DocTravel permite a la agencia guardar, organizar y controlar los documentos de sus pasajeros en un solo lugar, compartido por todo el equipo.

## Funciones principales

### 1) Gestion de pasajeros
- Alta, edicion y baja de pasajeros.
- Ficha completa con datos personales y de contacto.
- Informacion centralizada para todos los usuarios autorizados.

### 2) Gestion de documentos
- Carga y actualizacion de:
  - DNI
  - Pasaporte argentino
  - Pasaporte extranjero
  - Visa 1 y Visa 2
- Todos los documentos quedan asociados al pasajero y disponibles en tiempo real.

### 3) Alertas de vencimiento
- Semaforo visual para detectar rapidamente documentos:
  - Vencidos
  - Criticos (vencen pronto)
  - Por vencer
  - Vigentes
- Ayuda a prevenir rechazos o problemas por documentacion fuera de fecha.

### 4) Generacion automatica de strings GDS
- Genera en segundos los textos necesarios para Amadeus, Sabre y Galileo:
  - SRDOCS
  - SRFOID
  - SRDOCO
  - SRCTCE
  - CTCM
  - NM infante
- Incluye botones para copiar cada linea y tambien "copiar todo".
- Reduce errores manuales de tipeo y acelera la carga operativa.

### 5) Lectura de documentos con IA
- El agente sube o arrastra una foto del documento.
- La IA reconoce los datos y completa el formulario automaticamente.
- El usuario solo revisa y confirma.
- Esto reduce tiempos de carga y errores de transcripcion.

## Beneficios para la agencia

- Menos errores operativos.
- Menos tiempo de carga por pasajero.
- Mejor control de vencimientos.
- Trabajo en equipo sobre la misma base de datos.
- Implementacion simple y con costos bajos usando servicios gratuitos.
