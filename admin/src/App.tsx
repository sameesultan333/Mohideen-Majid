import { useEffect } from "react";
import { BrowserRouter } from "react-router-dom";
import AppRoutes from "./routes";
import { listenBrowserMessages } from "./utils/browserPush";
import { getAccessToken } from "./api/auth";

function App() {
  useEffect(() => {
    // Only start listening if the user is already authenticated (page refresh)
    if (!getAccessToken()) return;
    const unsub = listenBrowserMessages();
    return unsub;
  }, []);

  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}

export default App;
