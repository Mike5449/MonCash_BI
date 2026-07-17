import { useState, useEffect, useRef } from "react"
import { Bot, X, Send, Sparkles } from "lucide-react"

const INTRO_MESSAGE =
  "The idea is to build a ChatBot that answers all your questions about MonCash MOBILE FINANCIAL SERVICES and can run analyses based on our data."

export function ChatbotAssistant() {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState("")
  const [done, setDone] = useState(false)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    if (!open) {
      setTyped("")
      setDone(false)
      if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null }
      return
    }
    let i = 0
    timerRef.current = window.setInterval(() => {
      i += 1
      setTyped(INTRO_MESSAGE.slice(0, i))
      if (i >= INTRO_MESSAGE.length) {
        if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null }
        setDone(true)
      }
    }, 22)
    return () => {
      if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null }
    }
  }, [open])

  return (
    <>
      {/* Floating launcher button — bottom right */}
      <button
        onClick={() => setOpen(true)}
        title="Open assistant"
        aria-label="Open assistant"
        style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          zIndex: 998,
          width: '56px',
          height: '56px',
          borderRadius: '50%',
          border: 'none',
          background: 'var(--brand)',
          color: 'white',
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 10px 24px rgba(227, 27, 35, 0.36), 0 2px 6px rgba(15,23,42,0.18)',
          transform: open ? 'scale(0.85)' : 'scale(1)',
          opacity: open ? 0 : 1,
          pointerEvents: open ? 'none' : 'auto',
          transition: 'transform 0.18s ease, opacity 0.18s ease',
        }}
      >
        <Bot size={26} strokeWidth={1.75} />
        <span
          aria-hidden
          style={{
            position: 'absolute', top: '8px', right: '8px',
            width: '10px', height: '10px', borderRadius: '50%',
            background: '#22c55e',
            border: '2px solid var(--brand)',
          }}
        />
      </button>

      {/* Backdrop */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 999,
            background: 'rgba(15, 23, 42, 0.32)',
            backdropFilter: 'blur(2px)',
          }}
        />
      )}

      {/* Right-side drawer */}
      <aside
        role="dialog"
        aria-label="MonCash Assistant"
        aria-hidden={!open}
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 'min(440px, 92vw)',
          background: 'var(--surface-card)',
          borderLeft: '1px solid var(--border-default)',
          boxShadow: open ? '-24px 0 64px rgba(15, 23, 42, 0.28)' : 'none',
          zIndex: 1000,
          display: 'flex', flexDirection: 'column',
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.28s cubic-bezier(0.2, 0.8, 0.2, 1)',
        }}
      >
        {/* Header */}
        <div style={{
          padding: 'var(--space-4) var(--space-5)',
          borderBottom: '1px solid var(--border-default)',
          background: 'var(--surface-muted)',
          display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
        }}>
          <div style={{
            width: '36px', height: '36px',
            borderRadius: '50%',
            background: 'var(--brand)',
            color: 'white',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <Bot size={18} strokeWidth={1.75} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 'var(--fs-body)', fontWeight: 700,
              color: 'var(--text-primary)', lineHeight: 1.15,
            }}>
              MonCash Assistant
            </div>
            <div style={{
              fontSize: 'var(--fs-micro)', fontWeight: 500,
              color: 'var(--text-tertiary)',
              textTransform: 'uppercase', letterSpacing: 'var(--tracking-uppercase)',
              marginTop: '2px',
              display: 'flex', alignItems: 'center', gap: '6px',
            }}>
              <span style={{
                display: 'inline-block', width: '8px', height: '8px',
                borderRadius: '50%', background: '#22c55e',
              }} />
              Preview · BI Concierge
            </div>
          </div>
          <button
            onClick={() => setOpen(false)}
            title="Close"
            aria-label="Close assistant"
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: '32px', height: '32px',
              border: '1px solid var(--border-default)',
              background: 'var(--surface-card)',
              color: 'var(--text-secondary)',
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
            }}
          >
            <X size={14} strokeWidth={1.75} />
          </button>
        </div>

        {/* Messages area */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: 'var(--space-5)',
          display: 'flex', flexDirection: 'column', gap: 'var(--space-4)',
          background: 'var(--surface-card)',
        }}>
          {/* Bot message bubble with typing animation */}
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-start' }}>
            <div style={{
              width: '28px', height: '28px',
              borderRadius: '50%',
              background: 'var(--surface-muted)',
              border: '1px solid var(--border-default)',
              color: 'var(--brand)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <Sparkles size={14} strokeWidth={1.75} />
            </div>
            <div style={{
              background: 'var(--surface-muted)',
              border: '1px solid var(--border-default)',
              borderRadius: '14px 14px 14px 4px',
              padding: 'var(--space-3) var(--space-4)',
              fontSize: 'var(--fs-body)',
              lineHeight: 1.55,
              color: 'var(--text-primary)',
              maxWidth: '88%',
              minHeight: '48px',
            }}>
              <span>{typed}</span>
              {!done && (
                <span
                  aria-hidden
                  style={{
                    display: 'inline-block',
                    width: '7px', height: '14px',
                    marginLeft: '2px',
                    background: 'var(--text-primary)',
                    verticalAlign: 'text-bottom',
                    animation: 'chatbot-caret 1s steps(2, end) infinite',
                  }}
                />
              )}
            </div>
          </div>

          {done && (
            <div style={{
              marginTop: 'var(--space-1)',
              padding: 'var(--space-3) var(--space-4)',
              border: '1px dashed var(--border-default)',
              borderRadius: 'var(--radius-md)',
              background: 'transparent',
              color: 'var(--text-tertiary)',
              fontSize: 'var(--fs-label)',
              lineHeight: 1.5,
            }}>
              This window is a preview — the ChatBot isn't connected yet.
              Soon you'll be able to ask natural-language questions about
              transactions, churn, MTD, departments, channels, and more.
            </div>
          )}
        </div>

        {/* Composer (disabled placeholder) */}
        <div style={{
          padding: 'var(--space-3) var(--space-4)',
          borderTop: '1px solid var(--border-default)',
          background: 'var(--surface-muted)',
          display: 'flex', gap: 'var(--space-2)', alignItems: 'center',
        }}>
          <input
            type="text"
            placeholder="Coming soon · ask the assistant…"
            disabled
            style={{
              flex: 1,
              height: '36px',
              padding: '0 var(--space-3)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-default)',
              background: 'var(--surface-card)',
              fontSize: 'var(--fs-body)',
              color: 'var(--text-tertiary)',
            }}
          />
          <button
            disabled
            title="Send"
            style={{
              width: '36px', height: '36px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-default)',
              background: 'var(--surface-card)',
              color: 'var(--text-muted)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'not-allowed',
            }}
          >
            <Send size={14} strokeWidth={1.75} />
          </button>
        </div>
      </aside>

      <style>{`
        @keyframes chatbot-caret {
          0%, 50%   { opacity: 1; }
          50.01%, 100% { opacity: 0; }
        }
      `}</style>
    </>
  )
}
