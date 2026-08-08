import { useEffect } from "react";
import { BrowserRouter } from "react-router-dom";
import AppRoutes from "./routes";
import { listenBrowserMessages } from "./utils/browserPush";
import { getAccessToken } from "./api/auth";

function App() {
  useEffect(() => {
    // The access token lives in memory only, so on a page reload it is still
    // null at mount — ProtectedRoute restores it asynchronously from the
    // HttpOnly refresh cookie a moment later. Checking it here once meant the
    // foreground listener never attached after a refresh, and web push only
    // worked in the session where the password was actually typed.
    // Poll briefly for the restored token instead, then attach.
    let unsub: (() => void) | undefined;
    let cancelled = false;

    if (getAccessToken()) {
      unsub = listenBrowserMessages();
    } else {
      const started = Date.now();
      const timer = setInterval(() => {
        if (cancelled) return;
        if (getAccessToken()) {
          clearInterval(timer);
          unsub = listenBrowserMessages();
        } else if (Date.now() - started > 30_000) {
          // Not signed in — stop looking.
          clearInterval(timer);
        }
      }, 500);
      return () => { cancelled = true; clearInterval(timer); unsub?.(); };
    }

    return () => { cancelled = true; unsub?.(); };
  }, []);

  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}

export default App;
