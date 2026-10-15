// ============================================================
//  tenant.js — Contexto de agencia y branding multi-tenant
// ============================================================

export const SESSION_AGENCY_KEY = 'agencyId';

const DEFAULT_BRANDING = {
  appName: 'TravelDocs',
  // Sin logo por defecto: una agencia sin logo propio no debe heredar el de Trading Travel.
  logoUrl: '',
  primaryColor: null,
};

export function getStoredAgencyId() {
  try {
    return sessionStorage.getItem(SESSION_AGENCY_KEY);
  } catch {
    return null;
  }
}

export function storeAgencyId(agencyId) {
  try {
    sessionStorage.setItem(SESSION_AGENCY_KEY, agencyId);
  } catch (err) {
    console.warn('[tenant] No se pudo guardar agencyId en sessionStorage:', err);
  }
}

export function clearStoredAgencyId() {
  try {
    sessionStorage.removeItem(SESSION_AGENCY_KEY);
    // Marca de tráfico interno de GA4 (js/analytics.js): al cerrar sesión no
    // puede quedar pegada, contamina al próximo usuario del mismo tab.
    sessionStorage.removeItem('td_internal');
  } catch {
    // noop
  }
}

export function applyBranding(branding = {}) {
  const appName = branding.appName || DEFAULT_BRANDING.appName;
  const logoUrl = branding.logoUrl || DEFAULT_BRANDING.logoUrl;
  const primaryColor = branding.primaryColor || DEFAULT_BRANDING.primaryColor;

  // Si la agencia tiene logo, lo mostramos; si no, ocultamos el <img> para que
  // no quede un src vacío/roto y no se vea el logo de Trading Travel por default.
  document.querySelectorAll('.sidebar-brand-logo, .brand-logo').forEach(img => {
    if (logoUrl) {
      img.src = logoUrl;
      img.alt = appName;
      img.style.display = '';
    } else {
      img.removeAttribute('src');
      img.style.display = 'none';
    }
  });

  document.querySelectorAll('.brand-name').forEach(el => {
    el.textContent = appName;
  });

  const loadingText = document.getElementById('loading-text');
  if (loadingText) loadingText.textContent = `Cargando ${appName}...`;

  if (document.title.includes('Gestión de Documentos')) {
    document.title = `${appName} — Gestión de Documentos`;
  } else if (document.title.includes('Ingresar')) {
    document.title = `${appName} — Ingresar`;
  }

  if (primaryColor) {
    document.documentElement.style.setProperty('--accent', primaryColor);
  }
}

export function parseAgencyAlerts(agency) {
  const alerts = agency?.alerts || {};
  return {
    email: (alerts.email || '').trim(),
    emailjsPublicKey: (alerts.emailjsPublicKey || '').trim(),
    emailjsServiceId: (alerts.emailjsServiceId || '').trim(),
    emailjsTemplateId: (alerts.emailjsTemplateId || '').trim(),
  };
}

// Una sola cuenta EmailJS para todas las agencias. El alta la muestra ya
// cargada; si la agencia tiene otra, se respeta.
const EMAILJS_ALTA = {
  emailjsPublicKey: '9hDeLGPwhgAkqc7HZ',
  emailjsServiceId: 'service_g7h8qrd',
  emailjsTemplateId: 'template_jwdgrsr',
};

export function emailjsParaAlta(alerts) {
  const a = alerts || {};
  const puesto = (valor, base) => String(valor || '').trim() || base;
  return {
    emailjsPublicKey: puesto(a.emailjsPublicKey, EMAILJS_ALTA.emailjsPublicKey),
    emailjsServiceId: puesto(a.emailjsServiceId, EMAILJS_ALTA.emailjsServiceId),
    emailjsTemplateId: puesto(a.emailjsTemplateId, EMAILJS_ALTA.emailjsTemplateId),
  };
}