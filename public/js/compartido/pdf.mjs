const PDFJS_VER = '4.10.38';
let _pdfjsPromise = null;

function cargarPdfjs() {
  if (_pdfjsPromise) return _pdfjsPromise;
  const base = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VER}/build/`;
  _pdfjsPromise = (async () => {
    const pdfjs = await import(base + 'pdf.min.mjs');
    // worker-src es solo 'self' y blob. El worker del CDN se baja y se corre como blob.
    const res = await fetch(base + 'pdf.worker.min.mjs');
    if (!res.ok) throw new Error('worker');
    pdfjs.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([await res.arrayBuffer()], { type: 'text/javascript' }));
    return pdfjs;
  })().catch(err => {
    _pdfjsPromise = null;
    throw err;
  });
  return _pdfjsPromise;
}
export { cargarPdfjs };
