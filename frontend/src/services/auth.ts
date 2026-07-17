/**
 * Authentication service.
 *
 * Backend: ASP.NET API at http://hti-dtswebsrv:2020/api/Auth
 *
 * In **dev**, we never hit that URL directly — the browser would block it via
 * CORS. Instead, we use the Vite proxy mapping `/auth-api/*` → `http://hti-dtswebsrv:2020/api/Auth/*`
 * (see `vite.config.ts`). The browser sees a same-origin request to
 * `localhost:5173/auth-api/login`, Vite relays it server-side, no CORS dance.
 *
 * In **prod**, point `VITE_AUTH_API_URL` at the deployed reverse-proxy path
 * (e.g. `/auth-api` if you keep the same rewrite, or the full URL if the API
 * sets proper CORS headers).
 *
 * Session is cookie-based (`credentials: "include"`) — the API sets an
 * HTTP-only auth cookie on successful login. We mirror the authenticated user
 * profile in localStorage so the UI can render it without a round-trip.
 */

const API_URL: string = (import.meta as any)?.env?.VITE_AUTH_API_URL || "/auth-api"

const STORAGE_KEY = "moncash_bi_user"

export type AuthUser = {
  email: string
  name?: string
  role?: string
  [key: string]: any
}

export type LoginResult =
  | { ok: true; user: AuthUser }
  | { ok: false; error: string; status?: number }

/** Persist or read the currently authenticated user. */
export function getCurrentUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as AuthUser) : null
  } catch {
    return null
  }
}

export function isAuthenticated(): boolean {
  return getCurrentUser() !== null
}

function setCurrentUser(user: AuthUser): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(user))
}

function clearCurrentUser(): void {
  localStorage.removeItem(STORAGE_KEY)
}

// ── Local bypass account ──
// Reserved credentials that authenticate without contacting the ASP.NET server.
// Useful for demos, offline work, or when the backend is unreachable.
// Any other email/password combo falls through to the live API below.
const LOCAL_ADMIN_EMAIL    = "admin@gmail.com"
const LOCAL_ADMIN_PASSWORD = "admin"

/**
 * POST /api/Auth/login — sends credentials, expects a cookie back.
 * The response body shape varies by backend; we accept any JSON object and
 * fall back to `{ email }` if the server doesn't echo the user profile.
 *
 * Special case: the hardcoded local admin (admin@gmail.com / admin) is
 * authenticated client-side without ever touching the ASP.NET API.
 */
export async function login(email: string, password: string): Promise<LoginResult> {
  // 1) Local admin bypass — case-insensitive on email, exact on password.
  if (
    email.trim().toLowerCase() === LOCAL_ADMIN_EMAIL &&
    password === LOCAL_ADMIN_PASSWORD
  ) {
    const user: AuthUser = {
      email: LOCAL_ADMIN_EMAIL,
      name:  "Local Admin",
      role:  "admin",
      local: true,
    }
    setCurrentUser(user)
    return { ok: true, user }
  }

  // 2) Everyone else → real auth server.
  try {
    const response = await fetch(`${API_URL}/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
      credentials: "include",
    })

    if (!response.ok) {
      let message = `Login failed (HTTP ${response.status})`
      try {
        const body = await response.json()
        if (typeof body?.message === "string") message = body.message
        else if (typeof body?.error === "string") message = body.error
        else if (typeof body === "string")        message = body
      } catch {
        // not JSON — keep generic message
      }
      return { ok: false, error: message, status: response.status }
    }

    // Success — try to parse a user profile from the body, otherwise just store the email.
    let user: AuthUser = { email }
    try {
      const body = await response.json()
      if (body && typeof body === "object") {
        user = { ...user, ...body }
        // Normalize: ensure 'email' field is always set
        if (!user.email) user.email = email
      }
    } catch {
      // empty body or non-JSON — that's fine, the cookie is what matters
    }

    setCurrentUser(user)
    return { ok: true, user }
  } catch (e: any) {
    return {
      ok: false,
      error: e?.message ? `Network error: ${e.message}` : "Unable to reach the auth server.",
    }
  }
}

/** POST /api/Auth/logout — best-effort, always clears the local user. */
export async function logout(): Promise<void> {
  const current = getCurrentUser()
  // Local admin has no server-side session — skip the API call.
  if (!current?.local) {
    try {
      await fetch(`${API_URL}/logout`, {
        method: "POST",
        credentials: "include",
      })
    } catch {
      // ignore network errors — local logout still happens
    }
  }
  clearCurrentUser()
}
