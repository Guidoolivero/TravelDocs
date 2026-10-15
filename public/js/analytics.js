// Config de GA4 (G-JTG1QQCTXC), compartida por las 4 páginas.
// Script externo porque el CSP enforced (_headers) no permite scripts inline:
// la config que estaba inline en el <head> de cada página nunca se ejecutaba
// y la propiedad no recibía datos.
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
// Tráfico interno (agencia dueña): el flag td_internal lo setean login.js y
// app.mjs cuando el usuario es de trading-travel, y lo limpia clearStoredAgencyId.
// Se setea ANTES del config para que el page_view de la sesión ya lo lleve.
// GA4 usa el parámetro oficial traffic_type: crear en Admin -> Data filters el
// filtro "Internal Traffic" (Exclude, traffic_type = internal), arrancar en
// Testing y pasar a Active.
try {
  if (sessionStorage.getItem('td_internal') === '1') gtag('set', 'traffic_type', 'internal');
} catch (_) { /* storage bloqueado: seguir sin flag */ }
gtag('js', new Date());
gtag('config', 'G-JTG1QQCTXC');
// Cuenta de Google Ads (conversiones): se agrega a la misma etiqueta de Google
// según las instrucciones de Ads ("agregue el comando config a cada instancia").
gtag('config', 'AW-18430748722');
