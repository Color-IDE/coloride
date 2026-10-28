import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AgentMessageText, AgentTimelineItem } from "../src/features/agents/AgentTimeline";
import "../src/app/styles.css";

const example = String.raw`Positions in $\text{AU}$, velocity in $\text{AU/day}$, mass $M_\odot$, and $J_2$.

$$
F = G\frac{m_1 m_2}{r^2}, \qquad \sum_{i=1}^{n} x_i = \sqrt{a^2+b^2}
$$

Code stays literal.
`;
function Harness() {
  const [text, setText] = useState(example);
  const [input, setInput] = useState(example);
  const [streaming, setStreaming] = useState(false);
  const [messageKey, setMessageKey] = useState(0);
  const [card, setCard] = useState(false);
  useEffect(() => {
    const update = (event: Event) => {
      const next = (event as CustomEvent<{text: string; streaming: boolean; reset?: boolean; card?: boolean}>).detail;
      if (next.reset) setMessageKey((key) => key + 1);
      setText(next.text);
      setStreaming(next.streaming);
      setCard(Boolean(next.card));
    };
    window.addEventListener("coloride:test-stream", update);
    return () => window.removeEventListener("coloride:test-stream", update);
  }, []);
  return <main style={{padding:16,maxWidth:700,margin:"auto"}}>
    <textarea style={{display:"block",width:"100%",height:100,marginBottom:12}} aria-label="Markdown source" value={input} onChange={event => setInput(event.target.value)} />
    <button onClick={() => setText(input)}>Render message</button>
    <button onClick={() => setStreaming(!streaming)}>Toggle streaming</button>
    <div data-test-message-key={messageKey}>
      <AgentMessageText key={messageKey} text={text} streaming={streaming} />
    </div>
    {card ? <AgentTimelineItem entry={{id: "live-card", kind: "error", text: "A new activity card"}} turnActive /> : null}
  </main>;
}
createRoot(document.getElementById("root")!).render(<React.StrictMode><Harness /></React.StrictMode>);
