import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Provider } from "react-redux";
import { store } from "./store";
import App from "./App.tsx";
import { DOMErrorBoundary } from "./components/DOMErrorBoundary";
import "./index.css";

// Use a single div root instead of Fragment to avoid removeChild errors when browser
// extensions modify the DOM on production (see https://github.com/facebook/react/issues/17256).
createRoot(document.getElementById("root")!).render(
  <DOMErrorBoundary>
    <div id="react-root" style={{ minHeight: "100%", display: "flex", flexDirection: "column" }}>
      <Provider store={store}>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <App />
        </BrowserRouter>
      </Provider>
    </div>
  </DOMErrorBoundary>
);
