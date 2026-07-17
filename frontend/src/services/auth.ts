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

/**
 * DEMO MODE — accepts any email/password combination.
 * The real ASP.NET auth flow is disabled until the backend is wired to the
 * production auth server. See the previous implementation in git history if
 * you need to re-enable server-side auth.
 */
export async function login(email: string, password: string): Promise<LoginResult> {
  // Any non-empty credentials are accepted in demo mode.
  if (!email.trim() || !password) {
    return { ok: false, error: "Email and password are required." }
  }

  const trimmedEmail = email.trim()
  const user: AuthUser = {
    email: trimmedEmail,
    name:  trimmedEmail.split("@")[0] || "User",
    role:  "admin",
    local: true,
  }
  setCurrentUser(user)
  return { ok: true, user }
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
