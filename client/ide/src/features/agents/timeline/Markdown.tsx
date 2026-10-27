import {
  cloneElement,
  createContext,
  isValidElement,
  memo,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { useSmoothStreamingText } from "../useSmoothStreamingText";
import { hasNonEmptyTextSelection } from "./Primitives";

export const StreamWordsContext = createContext(false);

export const StreamWordsActiveContext = createContext(false);

export function StreamWord({ children }: { children: string }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setVisible(true);
      return;
    }
    const id = window.setTimeout(() => setVisible(true), 0);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <span className={`t-stream-w${visible ? " is-in" : ""}`}>{children}</span>
  );
}

export function wrapStreamWords(text: string, api: boolean): ReactNode {
  if (!api || !text) return text;
  const parts = text.split(/(\s+)/);
  const out: ReactNode[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i]!;
    if (!part) continue;
    if (/^\s+$/.test(part)) {
      out.push(part);
      continue;
    }
    out.push(<StreamWord key={`sw-${i}`}>{part}</StreamWord>);
  }
  return out.length === 1 ? out[0] : out;
}

export function streamifyChildren(
  node: ReactNode,
  api: boolean,
  skip = false,
): ReactNode {
  if (!api || node == null || typeof node === "boolean") return node;
  if (typeof node === "string" || typeof node === "number") {
    return skip ? node : wrapStreamWords(String(node), api);
  }
  if (Array.isArray(node)) {
    return node.map((child, index) => {
      const streamed = streamifyChildren(child, api, skip);
      if (isValidElement(streamed) && streamed.key == null) {
        return cloneElement(streamed, { key: index });
      }
      return streamed;
    });
  }
  if (!isValidElement(node)) return node;
  if (node.type === StreamInline) {
    return streamifyChildren(
      (node.props as { children?: ReactNode }).children,
      api,
      skip,
    );
  }
  const tag = typeof node.type === "string" ? node.type : "";
  const className = (node.props as { className?: string }).className;
  // KaTeX owns glyph spacing and MathML. Word animation must treat a formula
  // atomically rather than insert spans inside its layout or accessibility tree.
  if (
    tag === "math" ||
    (typeof className === "string" && /\bkatex(?:-|\b)/.test(className))
  )
    return node;
  const nextSkip = skip || tag === "code" || tag === "pre";
  const children = (node.props as { children?: ReactNode }).children;
  if (children == null) return node;
  return cloneElement(
    node,
    undefined,
    streamifyChildren(children, api, nextSkip),
  );
}

export function StreamInline({ children }: { children?: ReactNode }) {
  const api = useContext(StreamWordsContext);
  const nested = useContext(StreamWordsActiveContext);
  if (!api || nested) return <>{children}</>;
  return (
    <StreamWordsActiveContext.Provider value={true}>
      {streamifyChildren(children, api)}
    </StreamWordsActiveContext.Provider>
  );
}

export const AgentMessageText = memo(function AgentMessageText({
  text: sourceText,
  streaming = false,
  onOpenBrowserUrl,
}: {
  text: string;
  streaming?: boolean;
  onOpenBrowserUrl?: (url: string) => void;
}) {
  const text = useSmoothStreamingText(sourceText, streaming);
  const animatedRef = useRef(streaming);
  animatedRef.current ||= streaming;
  const revealing = animatedRef.current;
  const streamApi = revealing;

  const markdownComponents = useMemo<Components>(
    () => ({
      p: ({ children }) => (
        <p>
          <StreamInline>{children}</StreamInline>
        </p>
      ),
      li: ({ children }) => (
        <li>
          <StreamInline>{children}</StreamInline>
        </li>
      ),
      h1: ({ children }) => (
        <h1>
          <StreamInline>{children}</StreamInline>
        </h1>
      ),
      h2: ({ children }) => (
        <h2>
          <StreamInline>{children}</StreamInline>
        </h2>
      ),
      h3: ({ children }) => (
        <h3>
          <StreamInline>{children}</StreamInline>
        </h3>
      ),
      h4: ({ children }) => (
        <h4>
          <StreamInline>{children}</StreamInline>
        </h4>
      ),
      h5: ({ children }) => (
        <h5>
          <StreamInline>{children}</StreamInline>
        </h5>
      ),
      h6: ({ children }) => (
        <h6>
          <StreamInline>{children}</StreamInline>
        </h6>
      ),
      td: ({ children }) => (
        <td>
          <StreamInline>{children}</StreamInline>
        </td>
      ),
      th: ({ children }) => (
        <th>
          <StreamInline>{children}</StreamInline>
        </th>
      ),
      a: ({ href, children }) => {
        const url = String(href || "").trim();
        const internal =
          Boolean(onOpenBrowserUrl) &&
          url &&
          !url.startsWith("#") &&
          !url.startsWith("mailto:") &&
          !url.startsWith("javascript:");
        if (internal) {
          return (
            <a
              href={url}
              onClick={(event) => {
                // Keep text selection when the drag ends on a link.
                if (hasNonEmptyTextSelection()) {
                  event.preventDefault();
                  return;
                }
                event.preventDefault();
                onOpenBrowserUrl?.(url);
              }}
              rel="noreferrer"
            >
              {children}
            </a>
          );
        }
        return (
          <a
            href={href}
            onClick={(event) => {
              if (hasNonEmptyTextSelection()) event.preventDefault();
            }}
            rel="noreferrer noopener"
            target="_blank"
          >
            {children}
          </a>
        );
      },
      code: ({ className, children, ...props }) => {
        const content = String(children);
        const isBlock =
          Boolean(className?.includes("language-")) || content.includes("\n");
        if (isBlock) {
          return (
            <code className={className} {...props}>
              {children}
            </code>
          );
        }
        return (
          <code className="agent-md-inline-code" {...props}>
            {children}
          </code>
        );
      },
      pre: ({ children }) => <MarkdownCodeBlock>{children}</MarkdownCodeBlock>,
      table: ({ children }) => (
        <div className="agent-md-table-wrap">
          <table>{children}</table>
        </div>
      ),
      input: ({ checked, ...props }) => (
        <input
          {...props}
          checked={checked}
          className="agent-md-checkbox"
          disabled
          readOnly
          type="checkbox"
        />
      ),
    }),
    [onOpenBrowserUrl],
  );

  if (!text.trim()) return null;

  const markdown = (
    <ReactMarkdown
      components={markdownComponents}
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[
        [rehypeKatex, { trust: false, strict: "ignore", maxExpand: 1000 }],
      ]}
    >
      {text}
    </ReactMarkdown>
  );

  return (
    <div className="agent-markdown" data-text-pending={text !== sourceText}>
      {streamApi ? (
        <StreamWordsContext.Provider value={streamApi}>
          {markdown}
        </StreamWordsContext.Provider>
      ) : (
        markdown
      )}
    </div>
  );
});

export function MarkdownCodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    const value = extractTextContent(children).replace(/\n$/, "");
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore clipboard failures */
    }
  };

  return (
    <div className="agent-md-pre-wrap">
      <button
        aria-label={copied ? "Copied" : "Copy code"}
        className="agent-md-copy"
        onClick={() => void copy()}
        title={copied ? "Copied" : "Copy"}
        type="button"
      >
        {copied ? <MarkdownCopiedIcon /> : <MarkdownCopyIcon />}
      </button>
      <pre className="agent-md-pre">{children}</pre>
    </div>
  );
}

export function extractTextContent(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractTextContent).join("");
  if (typeof node === "object" && "props" in node) {
    const props = node.props as { children?: ReactNode };
    return extractTextContent(props.children);
  }
  return "";
}

export function MarkdownCopyIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="12"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      width="12"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M7 11V9C7 5.70017 7 4.05025 8.02513 3.02513C9.05025 2 10.7002 2 14 2C17.2998 2 18.9497 2 19.9749 3.02513C21 4.05025 21 5.70017 21 9V11C21 14.2998 21 15.9497 19.9749 16.9749C18.9497 18 17.2998 18 14 18C10.7002 18 9.05025 18 8.02513 16.9749C7 15.9497 7 14.2998 7 11Z" />
      <path d="M3 6V15C3 18.2998 3 19.9497 4.02513 20.9749C5.05025 22 6.70017 22 10 22H17" />
    </svg>
  );
}

export function MarkdownCopiedIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="12"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      width="12"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}
