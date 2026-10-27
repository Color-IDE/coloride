import { createRoot } from "react-dom/client";
import { ColorideMark, ColorideWordmark } from "../src/shared/ui/ColorideBrand";
import "../src/app/styles.css";

createRoot(document.getElementById("root")!).render(
  <main style={{ minHeight: "100vh", background: "#171717", color: "#dedede", display: "grid", placeContent: "center", gap: 32 }}>
    <div data-testid="loading-mark" style={{ width: 180, height: 180, margin: "0 auto" }}>
      <ColorideMark className="h-full w-full" shimmer />
    </div>
    <div style={{ width: 360 }}><ColorideWordmark /></div>
  </main>,
);
