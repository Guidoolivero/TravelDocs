# Checklist de Seguridad para Apps "Vibe Coded" (IA + Desarrollo Rápido)

**Fuente principal**: Post de @PrajwalTomar_ (Mayo 2026) expandiendo un post viral de Reddit en r/vibecoding (Abril 2026).  
**Autor**: Prajwal Tomar - Fundador de IgnytLabs (agencia de MVPs con IA).

Este documento resume las mejores prácticas de seguridad recomendadas para apps construidas rápido con herramientas como Cursor, Claude, Lovable, Bolt, Supabase, Vercel, etc. Ejecutar esta checklist toma ~30 minutos antes de cada lanzamiento.

## Por qué importa (2026)
- Apps con IA se shippean muy rápido pero suelen tener vulnerabilidades graves.
- Problemas comunes: facturas altas por abuso, fugas de datos, cartas de cese y desistimiento, breaches.
- La seguridad NO es una feature que se agrega después.

---

## Checklist Principal (Ejecutar antes de cada deploy)

### 1. Protección Legal y Privacidad
- [ ] Generar **Privacy Policy** (usar Termly o PrivacyPolicies.com - gratis y rápido).
- [ ] Saber exactamente dónde vive la data del usuario (Supabase region, Vercel, terceros).
- [ ] No vender/exportar data de usuarios ni prácticas dudosas.
- [ ] Cumplir GDPR/CCPA si recolectas emails o datos personales (aunque sea mínimo).

### 2. Bloquear la Base de Datos (Supabase u similar)
- [ ] Activar **Row Level Security (RLS)** en todas las tablas.
  - Ir a Supabase → Authentication → Policies.
  - Crear policies basadas en usuario autenticado (no dejar todo público).
- [ ] **Validación en Server-Side** (además del frontend).
  - Usar Zod u otra librería en el backend.
  - Validar tipos, longitud, sanitizar inputs.
- [ ] Mensajes de error **genéricos**.
  - Malo: "SELECT * FROM users WHERE email failed"
  - Bueno: "Usuario no encontrado"
  - Loguear errores completos solo en server-side.

### 3. Testear Flujos de Autenticación (Failure Cases)
- [ ] Login con contraseña incorrecta 5 veces → ¿Bloquea la cuenta? ¿Muestra error genérico?
- [ ] Password reset con email inexistente → ¿Revela si el email existe?
- [ ] Clickear link de verificación de email dos veces → ¿Maneja correctamente?
- [ ] Signup con email ya registrado → ¿Leak de información?

### 4. Auditoría con IA (Prompts recomendados)
Copia estos prompts en Cursor/Claude/Code:

1. **Postura de seguridad base**:
   ```
   Review my app as a security specialist and make sure I have strong security headers and a solid baseline security posture.
   ```

2. **OWASP**:
   ```
   Review my app against OWASP standards and highlight vulnerabilities (SQL injection, XSS, auth issues, etc.).
   ```

3. **Fugas de datos**:
   ```
   Check my app for any credential or sensitive data leaks in frontend or API routes.
   ```

4. **API Keys**:
   ```
   Ensure no API keys are exposed in frontend code or network calls.
   ```

### 5. Llaves y Secrets
- [ ] **Public keys** OK en frontend (anon key de Supabase, publishable Stripe).
- [ ] **Secret keys** SOLO en server-side (env vars, Supabase Edge Secrets, Vercel env).
- [ ] Nunca commitear .env ni pegar keys en código.
- [ ] Si sospechás exposición → regenerar inmediatamente.

### 6. Infraestructura y Protección contra Abuso
- [ ] **Rate limiting** en todos los endpoints (especialmente los que llaman APIs pagas como OpenAI, Stripe).
  - Recomendado: Upstash o similar para Supabase Edge Functions.
  - Setear caps diarios en dashboards de OpenAI/Anthropic.
- [ ] **CAPTCHA** en forms públicos (Cloudflare Turnstile - gratis).
- [ ] **CORS** restringido solo a tu dominio de producción + localhost.
- [ ] Alerts de billing al 50% de uso.

### 7. Scan Final Automático
- [ ] Ejecutar el security scanner integrado en Cursor/Claude Code/Lovable.
- [ ] Corregir TODO lo que marque (RLS, secrets expuestos, dependencias vulnerables).

---

## Notas Importantes
- Esta checklist te lleva a un **baseline sólido**, no a compliance enterprise.
- Si manejás datos sensibles (salud, finanzas) → necesitas auditoría profesional.
- Testear siempre como usuario no autenticado y con cuentas diferentes.
- RLS mal configurado es peor que no tenerlo (falsa sensación de seguridad).

## TL;DR - Las 5 cosas más críticas
1. RLS activado y probado.
2. Secrets nunca en frontend.
3. Rate limiting + CAPTCHA.
4. Validación server-side.
5. Privacy Policy + prompts de IA.

---

**Recomendación**: Guarda este archivo en tu repo y revísalo antes de cada lanzamiento.  
Actualizado: Junio 2026.

Si querés agregar secciones específicas de tu proyecto (Next.js, Supabase, Firebase, etc.), decime y lo expandimos.
