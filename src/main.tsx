import {StrictMode} from "react";
import {createRoot} from "react-dom/client";
import App from "./App.tsx";
import "./styles/index.css";

// react's dev build emits performance marks/measures on every commit
// (component performance tracks), and the user-timing buffer is unbounded —
// each entry pins its `detail` object graph forever, so a long dev session
// accumulates gigabytes of tiny arrays and the GC crawls millions of live
// objects. cap the buffer by clearing it periodically; profiler recordings
// capture entries at emission time, so clearing costs them nothing. dev-only:
// the production build doesn't emit these.
if (import.meta.env.DEV) {
	window.setInterval(() => {
		performance.clearMarks();
		performance.clearMeasures();
		performance.clearResourceTimings();
	}, 10_000);
}

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<App />
	</StrictMode>
);
