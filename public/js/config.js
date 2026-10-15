// ============================================================
//  CONFIGURACIÓN DE FIREBASE Y GEMINI
//  ⚠️  COMPLETAR CON TUS DATOS ANTES DE DEPLOYAR
// ============================================================

// 1. Ir a https://console.firebase.google.com
// 2. Crear proyecto → Agregar app web → Copiar firebaseConfig
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBBqUsxjkLx2RMNQ7ivIINX0kAznlICyHc",
  authDomain: "tradingdocs-mt.firebaseapp.com",
  projectId: "tradingdocs-mt",
  storageBucket: "tradingdocs-mt.firebasestorage.app",
  messagingSenderId: "219942999744",
  appId: "1:219942999744:web:992dda429dfdb624163f25",
  measurementId: "G-JTG1QQCTXC"
};

// La API key de Gemini se configura en Netlify (nunca en este archivo):
// Netlify → Site settings → Environment variables → GEMINI_API_KEY

// 2FA obligatorio (TOTP): se activa solo el 21/09/2026 a las 00:00 de Argentina.
// Antes de esa fecha es opcional (no fuerza enrolamiento).
// REQUIRE_2FA_FROM se exporta para el test js/2fa-activation.test.mjs.
// El lado servidor (_auth.cjs) usa la misma fecha. Para desactivar:
// volver a false aca y sacar la fecha en _auth.cjs, y deployar.
export const REQUIRE_2FA_FROM = new Date('2026-09-21T00:00:00-03:00');
export const REQUIRE_2FA = Date.now() >= REQUIRE_2FA_FROM.getTime();
