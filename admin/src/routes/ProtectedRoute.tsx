import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";

import {
  isAuthenticated,
  refreshAccessToken,
  getCurrentUser,
} from "../api/auth";

interface Props {
  children: import("react").ReactNode;
}

export default function ProtectedRoute({
  children,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    const authenticate = async () => {
      try {
        // Already authenticated
        if (isAuthenticated()) {
          const user = getCurrentUser();
          // Restrict admin panel to admin and superadmin only
          if (user && (user.role === "admin" || user.role === "superadmin")) {
            setAuthenticated(true);
            setAuthorized(true);
            return;
          }
        }

        // Try restoring session from HttpOnly refresh cookie
        await refreshAccessToken();
        
        const user = getCurrentUser();
        // Restrict admin panel to admin and superadmin only
        if (user && (user.role === "admin" || user.role === "superadmin")) {
          setAuthenticated(true);
          setAuthorized(true);
          return;
        }
        
        setAuthenticated(false);
        setAuthorized(false);
      } catch {
        setAuthenticated(false);
        setAuthorized(false);
      } finally {
        setLoading(false);
      }
    };

    authenticate();
  }, []);

  if (loading) {
    return (
      <div
        style={{
          height: "100vh",
          display: "grid",
          placeItems: "center",
          fontSize: 16,
          fontWeight: 600,
        }}
      >
        Loading...
      </div>
    );
  }

  if (!authenticated) {
    return <Navigate to="/login" replace />;
  }

  if (!authorized) {
    return (
      <div
        style={{
          height: "100vh",
          display: "grid",
          placeItems: "center",
          fontSize: 16,
          fontWeight: 600,
          color: "#A13A3A",
          textAlign: "center",
          padding: "20px",
        }}
      >
        Access denied. Only administrators can access this panel.
      </div>
    );
  }

  return <>{children}</>;
}