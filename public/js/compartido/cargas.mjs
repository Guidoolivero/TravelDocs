let _scannerP, _itinerarioP, _travelReqsP;
function loadScanner() { return _scannerP || (_scannerP = import('../documentos/scanner.js')); }
function loadItinerario() { return _itinerarioP || (_itinerarioP = import('../reservas/itinerario-pdf.mjs')); }
function loadTravelReqs() { return _travelReqsP || (_travelReqsP = import('../requisitos/travel-reqs.mjs')); }
export { loadScanner, loadItinerario, loadTravelReqs };
