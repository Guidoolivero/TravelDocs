// Sesion de 3 horas desde el ultimo login (password + 2FA).
// Se mide con los claims del JWT de Firebase: auth_time (cuando entro) e
// iat (cuando el server emitio el token). Usar iat y no la hora de la PC
// evita que un reloj desfasado corte la sesion de entrada o la estire.
export const SESION_MAX_MS = 3 * 60 * 60 * 1000;

// Devuelve el momento, en el reloj local, en que vence la sesion.
// claims: { auth_time, iat } en segundos, de un token recien emitido.
// ahora: Date.now() al recibir ese token.
export function venceSesion(claims, ahora) {
  const transcurrido = (Number(claims.iat) - Number(claims.auth_time)) * 1000;
  if (!Number.isFinite(transcurrido)) return ahora;
  return ahora + SESION_MAX_MS - transcurrido;
}
