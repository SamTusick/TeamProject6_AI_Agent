import { createRoot } from "react-dom/client";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "./css/variables.css";
import "./css/base.css";
import "./css/layout.css";
import "./css/sidebar.css";
import "./css/banners.css";
import "./css/meeting.css";
import "./css/transcript.css";
import "./css/review.css";
import "./css/recorder.css";
import "./css/modal.css";
import "./css/responsive.css";
import App from "./App.jsx";

createRoot(document.getElementById("root")).render(<App />);
