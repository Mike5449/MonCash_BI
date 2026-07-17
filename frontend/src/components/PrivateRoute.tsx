import { Navigate, useLocation } from "react-router-dom"
import { isAuthenticated } from "../services/auth"

/**
 * Wraps a protected element: if no user is in localStorage, redirect to /login,
 * remembering the originally-requested path so we can bounce back after login.
 */
export function PrivateRoute({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  if (!isAuthenticated()) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }
  return <>{children}</>
}
