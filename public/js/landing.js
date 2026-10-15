// =========================================================
// TravelDocs — Landing
// JS vanilla + Motion One (CDN ESM) para scroll reveal,
// efecto "escritura" del string SSR y microinteracciones.
// Si Motion no carga (CDN caído), cae a IntersectionObserver.
// =========================================================

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ----- Año del footer -----
const yearEl = document.getElementById('year');
if (yearEl) yearEl.textContent = new Date().getFullYear();

// ----- Nav: estado "scrolled" -----
const nav = document.getElementById('nav');
const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 8);
onScroll();
window.addEventListener('scroll', onScroll, { passive: true });

// ----- Nav: menú móvil -----
const burger = document.getElementById('nav-burger');
const mobile = document.getElementById('nav-mobile');
if (burger && mobile) {
  const close = () => {
    mobile.hidden = true;
    burger.setAttribute('aria-expanded', 'false');
  };
  burger.addEventListener('click', () => {
    const open = mobile.hidden;
    mobile.hidden = !open;
    burger.setAttribute('aria-expanded', String(open));
  });
  mobile.querySelectorAll('a').forEach(a => a.addEventListener('click', close));
}

// ----- Botón "Copiar todo" del mock SSR -----
const copyBtn = document.getElementById('ssr-copy');
const ssrCode = document.getElementById('ssr-code');
if (copyBtn && ssrCode) {
  const originalLabel = copyBtn.textContent;
  copyBtn.addEventListener('click', async () => {
    const text = ssrCode.textContent;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback para navegadores sin Clipboard API
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch {}
      ta.remove();
    }
    copyBtn.textContent = 'Copiado ✓';
    copyBtn.classList.add('btn-primary');
    copyBtn.classList.remove('btn-secondary');
    setTimeout(() => {
      copyBtn.textContent = originalLabel;
      copyBtn.classList.remove('btn-primary');
      copyBtn.classList.add('btn-secondary');
    }, 1600);
  });
}

// ----- Reveal on scroll -----
// Cada .reveal entra con un pequeño retiro opcional (data-reveal-delay, en pasos de ~80ms)
const reveals = Array.from(document.querySelectorAll('.reveal'));
const revealDelays = { '0': 0, '1': 80, '2': 160, '3': 240, '4': 320 };

function revealWithCSS() {
  // Fallback nativo: IntersectionObserver + clase CSS
  if (prefersReducedMotion || !('IntersectionObserver' in window)) {
    reveals.forEach(el => el.classList.add('is-visible'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const d = entry.target.getAttribute('data-reveal-delay');
        setTimeout(() => entry.target.classList.add('is-visible'), revealDelays[d] || 0);
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15, rootMargin: '0px 0px -8% 0px' });
  reveals.forEach(el => io.observe(el));
}

// Efecto "escritura" del string SSR cuando entra en viewport
function typeSSR() {
  if (!ssrCode) return;
  const full = ssrCode.textContent;
  if (prefersReducedMotion) return; // dejar el texto completo
  ssrCode.textContent = '';
  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        io.unobserve(ssrCode);
        let i = 0;
        const step = () => {
          if (i <= full.length) {
            ssrCode.textContent = full.slice(0, i);
            i++;
            setTimeout(step, 12);
          }
        };
        step();
      }
    });
  }, { threshold: 0.6 });
  io.observe(ssrCode);
}

// ----- Intento con Motion One; si falla, fallback CSS -----
async function initMotion() {
  const { animate, inView } = await import('https://cdn.jsdelivr.net/npm/motion@11/+esm');

  // Reveal con Motion (respetando reduced-motion)
  if (prefersReducedMotion) {
    reveals.forEach(el => el.classList.add('is-visible'));
    return;
  }

  reveals.forEach(el => {
    const stop = inView(el, () => {
      const d = (revealDelays[el.getAttribute('data-reveal-delay')] || 0) / 1000;
      animate(el,
        { opacity: [0, 1], transform: ['translateY(18px)', 'translateY(0)'] },
        {
          duration: 0.6, delay: d, easing: [0.2, 0.8, 0.2, 1],
          onComplete: () => {
            // Limpio el transform inline para que el :hover de la tarjeta siga funcionando
            el.style.transform = '';
            el.classList.add('is-visible');
          }
        }
      );
      stop();
    }, { margin: '0px 0px -8% 0px' });
  });

  // Efecto escritura del SSR con Motion
  if (ssrCode) {
    const full = ssrCode.textContent;
    const stop = inView(ssrCode, () => {
      ssrCode.textContent = '';
      animate(0, full.length, {
        duration: Math.min(2.4, full.length * 0.018),
        easing: 'linear',
        onUpdate: v => { ssrCode.textContent = full.slice(0, Math.round(v)); }
      });
      stop();
    }, { margin: '0px 0px -20% 0px' });
  }
}

// Arranca: Motion si reduced-motion está apagado y el CDN responde; si no, fallback
if (prefersReducedMotion) {
  reveals.forEach(el => el.classList.add('is-visible'));
} else {
  initMotion().catch(() => {
    // CDN caído o sin red: revelar con CSS/IO
    revealWithCSS();
    typeSSR();
  });
}

// ----- Conversión: pedido de demo (WhatsApp/email) -----
// La landing no tiene form: convierte por click a wa.me / mailto.
// Marcar generate_lead como "evento clave" en GA4 (Admin -> Eventos).
// Además dispara la conversión "Contacto" de Google Ads en CADA clic
// (Ads deduplica por su lado con las ventanas de conversión de la campaña;
// el guard de sesión es solo para el evento de GA4).
const LEAD_SESSION_KEY = 'td_lead_session';
document.querySelectorAll('a[href^="https://wa.me/"], a[href^="mailto:"]').forEach(a => {
  a.addEventListener('click', () => {
    if (window.gtag) {
      // Conversión "Contacto" de Google Ads (config AW-... en js/analytics.js)
      window.gtag('event', 'conversion', {
        send_to: 'AW-18430748722/3_N4CK-Ou-4cELLQu9RE',
        value: 1.0,
        currency: 'ARS'
      });
    }
    try {
      if (sessionStorage.getItem(LEAD_SESSION_KEY)) return;
    } catch { /* sin storage disponible: registrar igual */ }
    if (!window.gtag) return; // sin analytics no gastar el guard de la sesión
    window.gtag('event', 'generate_lead', {
      method: a.getAttribute('href').startsWith('mailto:') ? 'email' : 'whatsapp'
    });
    try { sessionStorage.setItem(LEAD_SESSION_KEY, '1'); } catch { /* sin storage: puede duplicarse */ }
  });
});
