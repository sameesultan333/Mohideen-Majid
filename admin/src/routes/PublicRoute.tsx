import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";

import {
  isAuthenticated,
  refreshAccessToken,
} from "../api/auth";

interface PublicRouteProps {
  children: import("react").ReactNode;
}

export default function PublicRoute({
  children,
}: PublicRouteProps) {
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    const checkAuthentication = async () => {
      try {
        // Already have an access token
        if (isAuthenticated()) {
          setAuthenticated(true);
          return;
        }

        // Try restoring session using refresh cookie
        await refreshAccessToken();

        setAuthenticated(true);
      } catch {
        setAuthenticated(false);
      } finally {
        setLoading(false);
      }
    };

    checkAuthentication();
  }, []);

  if (loading) {
    return (
      <div
        style={{
          height: "100vh",
          display: "grid",
          placeItems: "center",
          fontSize: "16px",
          fontWeight: 600,
        }}
      >
        Loading...
      </div>
    );
  }

  if (authenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}