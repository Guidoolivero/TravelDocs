// Conserva la URL publica de la funcion en Netlify.
const v2 = require('./_v2.cjs');
exports.default = v2(require('./lib/administracion/admin-api.cjs').handler);
