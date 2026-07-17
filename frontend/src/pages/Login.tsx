import { useState, useEffect } from "react"
import { useNavigate, useLocation } from "react-router-dom"
import { User, Lock, LogIn, AlertCircle, Eye, EyeOff, Loader2 } from "lucide-react"
import { login as apiLogin, isAuthenticated } from "../services/auth"
import "../premium.css"

export default function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as any)?.from?.pathname || "/"

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // If already logged in, bounce to home (or the intended destination).
  useEffect(() => {
    if (isAuthenticated()) navigate(from, { replace: true })
  }, [from, navigate])

  const canSubmit = email.trim().length > 0 && password.length > 0 && !submitting

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setError(null)
    setSubmitting(true)
    try {
      const result = await apiLogin(email.trim(), password)
      if (result.ok) {
        navigate(from, { replace: true })
      } else {
        setError(result.error || "Login failed")
      }
    } catch (err: any) {
      setError(err?.message || "Unexpected error")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'grid',
      placeItems: 'center',
      background: 'var(--surface-canvas)',
      padding: 'var(--space-6)',
      // Subtle backdrop pattern via the canvas color — Operational Ledger keeps it plain
    }}>
      <div style={{
        width: '100%',
        maxWidth: '420px',
        background: 'var(--surface-card)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
      }}>
        {/* Top accent stripe — brand */}
        <div style={{ height: '3px', background: 'var(--brand)' }} />

        {/* Header — logo + title */}
        <div style={{ padding: 'var(--space-8) var(--space-8) var(--space-6)' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
            marginBottom: 'var(--space-6)',
          }}>
            <img
              src="/moncah-logo.png"
              alt="MonCash"
              style={{ width: '44px', height: '44px', objectFit: 'contain', flexShrink: 0 }}
            />
            <div>
              <div style={{
                fontSize: 'var(--fs-micro)', fontWeight: 600,
                color: 'var(--text-tertiary)',
                textTransform: 'uppercase',
                letterSpacing: 'var(--tracking-uppercase)',
              }}>
                MonCash · BI Analytics
              </div>
              <div style={{
                fontSize: 'var(--fs-lg)', fontWeight: 600,
                color: 'var(--text-primary)',
                letterSpacing: 'var(--tracking-tight)',
                lineHeight: 1.15,
              }}>
                Sign in
              </div>
            </div>
          </div>

          <p style={{
            margin: 0,
            fontSize: 'var(--fs-body)',
            color: 'var(--text-secondary)',
          }}>
            Use your Digicel account credentials to access the analytics &amp; audit portal.
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ padding: '0 var(--space-8) var(--space-8)' }}>
          {/* Username */}
          <Field label="Username">
            <div style={{
              position: 'relative',
              display: 'flex', alignItems: 'center',
              background: 'var(--surface-card)',
              border: '1px solid ' + (email ? 'var(--text-primary)' : 'var(--border-default)'),
              borderRadius: 'var(--radius-md)',
              transition: 'border-color 0.12s',
            }}>
              <User size={14} strokeWidth={1.75} color="var(--text-tertiary)"
                style={{ position: 'absolute', left: 'var(--space-3)', pointerEvents: 'none' }} />
              <input
                type="text"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                required
                disabled={submitting}
                placeholder="your username"
                style={{
                  width: '100%', height: '42px',
                  paddingLeft: 'var(--space-8)', paddingRight: 'var(--space-3)',
                  border: 'none', background: 'transparent', outline: 'none',
                  fontSize: 'var(--fs-body)', fontWeight: 500,
                  color: 'var(--text-primary)',
                }}
              />
            </div>
          </Field>

          {/* Password */}
          <div style={{ marginTop: 'var(--space-4)' }}>
            <Field label="Password">
              <div style={{
                position: 'relative',
                display: 'flex', alignItems: 'center',
                background: 'var(--surface-card)',
                border: '1px solid ' + (password ? 'var(--text-primary)' : 'var(--border-default)'),
                borderRadius: 'var(--radius-md)',
                transition: 'border-color 0.12s',
              }}>
                <Lock size={14} strokeWidth={1.75} color="var(--text-tertiary)"
                  style={{ position: 'absolute', left: 'var(--space-3)', pointerEvents: 'none' }} />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                  disabled={submitting}
                  placeholder="••••••••"
                  style={{
                    width: '100%', height: '42px',
                    paddingLeft: 'var(--space-8)', paddingRight: '40px',
                    border: 'none', background: 'transparent', outline: 'none',
                    fontSize: 'var(--fs-body)', fontWeight: 500,
                    color: 'var(--text-primary)',
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(s => !s)}
                  disabled={submitting}
                  title={showPassword ? "Hide password" : "Show password"}
                  style={{
                    position: 'absolute', right: 'var(--space-2)',
                    background: 'transparent', border: 'none',
                    color: 'var(--text-tertiary)',
                    cursor: 'pointer',
                    padding: '4px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    borderRadius: 'var(--radius-xs)',
                  }}
                >
                  {showPassword
                    ? <EyeOff size={14} strokeWidth={1.75} />
                    : <Eye size={14} strokeWidth={1.75} />}
                </button>
              </div>
            </Field>
          </div>

          {/* Error banner */}
          {error && (
            <div style={{
              marginTop: 'var(--space-4)',
              padding: 'var(--space-3)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--negative)',
              borderLeft: '3px solid var(--negative)',
              background: 'var(--surface-card)',
              display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)',
              fontSize: 'var(--fs-body)',
              color: 'var(--text-primary)',
            }}>
              <AlertCircle size={14} strokeWidth={1.75} color="var(--negative)"
                style={{ flexShrink: 0, marginTop: '2px' }} />
              <span>{error}</span>
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={!canSubmit}
            style={{
              marginTop: 'var(--space-6)',
              width: '100%', height: '44px',
              background: canSubmit ? 'var(--brand)' : 'var(--surface-muted)',
              color: canSubmit ? 'white' : 'var(--text-muted)',
              border: '1px solid ' + (canSubmit ? 'var(--brand)' : 'var(--border-default)'),
              borderRadius: 'var(--radius-md)',
              fontWeight: 600, fontSize: 'var(--fs-body)',
              letterSpacing: '0.01em',
              cursor: canSubmit ? 'pointer' : 'not-allowed',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-2)',
              transition: 'opacity 0.12s',
            }}
          >
            {submitting
              ? <><Loader2 size={15} strokeWidth={1.75} className="animate-spin" /> Signing in…</>
              : <><LogIn size={15} strokeWidth={1.75} /> Sign in</>}
          </button>

          {/* Footer hint */}
          <div style={{
            marginTop: 'var(--space-5)',
            paddingTop: 'var(--space-4)',
            borderTop: '1px solid var(--border-faint)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            fontSize: 'var(--fs-label)',
            color: 'var(--text-tertiary)',
          }}>
            <span style={{
              fontSize: 'var(--fs-micro)', fontWeight: 500,
              textTransform: 'uppercase',
              letterSpacing: 'var(--tracking-uppercase)',
            }}>
              Internal access only
            </span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>v2.6</span>
          </div>
        </form>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string, children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <label style={{
        fontSize: 'var(--fs-micro)', fontWeight: 600,
        color: 'var(--text-tertiary)',
        textTransform: 'uppercase',
        letterSpacing: 'var(--tracking-uppercase)',
      }}>
        {label}
      </label>
      {children}
    </div>
  )
}
