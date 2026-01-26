import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import { useEffect, useState, useRef, memo } from "react";
import mermaid from "mermaid";
import { getPlatform } from "../platform";

// Initialize Mermaid once with theme matching the app color scheme
let mermaidInitialized = false;
const initMermaid = () => {
  if (!mermaidInitialized) {
    mermaid.initialize({
      startOnLoad: false,
      theme: 'base',
      logLevel: 'error', // Only log errors, not warnings
      themeVariables: {
        primaryColor: '#D97757',
        primaryTextColor: '#1A1915',
        primaryBorderColor: '#EFEEE9',
        lineColor: '#4A4A45',
        secondaryColor: '#F5D0C5',
        tertiaryColor: '#FAF9F6',
        background: '#FFFFFF',
        mainBkg: '#FFFFFF',
        nodeBorder: '#E5E4DF',
        clusterBkg: '#F5F4F1',
        clusterBorder: '#D1D1CC',
      }
    });
    mermaidInitialized = true;
  }
};

// Store IDs of mermaid diagrams we're currently rendering
const renderingIds = new Set<string>();

// Clean up any mermaid artifacts in the DOM
const cleanupMermaidArtifacts = (currentId?: string) => {
  const body = document.body;
  if (!body) return;

  // Remove mermaid temp elements that aren't part of active rendering
  body.querySelectorAll('[id^="mermaid-"]').forEach(el => {
    const id = el.id;
    // Only remove if it's not the current element being rendered
    // and not in our active set
    if (id !== currentId && !renderingIds.has(id)) {
      const text = el.textContent?.trim() || '';
      if (text.includes('error in text') || text.includes('mermaid version') || text.includes('Parse error')) {
        console.log('[Mermaid] Removing artifact:', id, text.substring(0, 50));
        el.remove();
      }
    }
  });

  // Also check for any orphaned error elements that might be in the DOM
  const allDivs = body.querySelectorAll('div');
  allDivs.forEach(el => {
    const text = el.textContent?.trim() || '';
    // Remove elements that are clearly mermaid error messages
    if ((text.includes('error in text') || text.includes('mermaid version')) &&
        text.length < 200 &&
        !el.querySelector('svg') && // Not a rendered diagram
        el.children.length === 0) { // Simple text node, not complex structure
      console.log('[Mermaid] Removing error element:', el);
      el.remove();
    }
  });
};

const MermaidDiagram = ({ code }: { code: string }) => {
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const currentIdRef = useRef<string | null>(null);

  useEffect(() => {
    initMermaid();

    const renderDiagram = async () => {
      const id = `mermaid-${Math.random().toString(36).substr(2, 9)}`;
      currentIdRef.current = id;
      renderingIds.add(id);

      // Clean up any previous mermaid artifacts before rendering
      cleanupMermaidArtifacts(id);

      try {
        const cleanCode = code.trim();
        const { svg } = await mermaid.render(id, cleanCode);

        // Remove the temporary element that mermaid creates during rendering
        const tempElement = document.getElementById(id);
        if (tempElement) {
          tempElement.remove();
        }

        // Clean up any artifacts that may have been added during render
        cleanupMermaidArtifacts(id);

        setSvg(svg);
        setError(null);
      } catch (err) {
        // Mermaid v11 throws error with a special structure
        console.error('Mermaid rendering error:', err);

        // Clean up any artifacts even on error
        cleanupMermaidArtifacts(id);

        // Try to extract error from mermaid's error structure
        let errorMsg = 'Failed to render diagram';
        if (err instanceof Error) {
          errorMsg = err.message;
        } else if (typeof err === 'object' && err !== null) {
          errorMsg = (err as any).message || JSON.stringify(err);
        }

        setError(errorMsg);
      } finally {
        // Remove from active set when done
        renderingIds.delete(id);
        currentIdRef.current = null;
      }
    };

    renderDiagram();

    // Cleanup function for when component unmounts or code changes
    return () => {
      const id = currentIdRef.current;
      if (id) {
        renderingIds.delete(id);
      }
    };
  }, [code]);

  // Additional cleanup on unmount for any remaining artifacts
  useEffect(() => {
    return () => {
      cleanupMermaidArtifacts(currentIdRef.current ?? undefined);
    };
  }, []);

  if (error) {
    return (
      <div className="mt-3 rounded-xl bg-error-light border border-error/20 p-3">
        <p className="text-sm text-error">Mermaid diagram error: {error}</p>
        <pre className="mt-2 text-xs text-error/80 overflow-x-auto">{code}</pre>
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className="mt-3 flex justify-center p-4 rounded-xl bg-surface-tertiary overflow-x-auto"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
};

const MDContentInternal = ({ text }: { text: string }) => {
  const handleLinkClick = (href: string) => {
    if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
      getPlatform().sendClientEvent({ type: "open.external", payload: { url: href } });
    }
  };

  return (
    <div className="max-w-full">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, rehypeHighlight]}
        components={{
        h1: (props) => <h1 className="mt-4 text-xl font-semibold text-ink-900" {...props} />,
        h2: (props) => <h2 className="mt-4 text-lg font-semibold text-ink-900" {...props} />,
        h3: (props) => <h3 className="mt-3 text-base font-semibold text-ink-800" {...props} />,
        p: (props) => <p className="mt-2 text-base leading-relaxed text-ink-700" {...props} />,
        ul: (props) => <ul className="mt-2 ml-4 grid list-disc gap-1" {...props} />,
        ol: (props) => <ol className="mt-2 ml-4 grid list-decimal gap-1" {...props} />,
        li: (props) => <li className="min-w-0 text-ink-700" {...props} />,
        strong: (props) => <strong className="text-ink-900 font-semibold" {...props} />,
        em: (props) => <em className="text-ink-800" {...props} />,
        a: (props) => (
          <a
            className="text-accent hover:text-accent-hover underline cursor-pointer transition-colors"
            onClick={(e) => {
              e.preventDefault();
              if (props.href) {
                handleLinkClick(props.href);
              }
            }}
            {...props}
          />
        ),
        pre: (props) => (
          <pre
            className="mt-3 max-w-full overflow-x-auto whitespace-pre-wrap rounded-xl bg-surface-tertiary p-3 text-sm text-ink-700"
            {...props}
          />
        ),
        code: (props) => {
          const { children, className, ...rest } = props;
          const match = /language-(\w+)/.exec(className || "");
          const isInline = !match && !String(children).includes("\n");
          const language = match?.[1];

          // Handle mermaid diagrams - only by language-mermaid class
          if (language === 'mermaid' && !isInline) {
            return <MermaidDiagram code={String(children).trim()} />;
          }

          return isInline ? (
            <code className="rounded bg-surface-tertiary px-1.5 py-0.5 text-accent font-mono text-base" {...rest}>
              {children}
            </code>
          ) : (
            <code className={`${className} font-mono`} {...rest}>
              {children}
            </code>
          );
        },
        // Markdown table components with borders
        table: (props) => (
          <div className="mt-3 overflow-x-auto rounded-lg border border-ink-900/20 bg-surface-tertiary" style={{ maxWidth: '100%' }}>
            <table className="border-collapse text-sm whitespace-nowrap" {...props} />
          </div>
        ),
        thead: (props) => (
          <thead className="border-b border-ink-900/20 bg-surface-secondary" {...props} />
        ),
        tbody: (props) => <tbody className="divide-y divide-ink-900/10" {...props} />,
        tr: (props) => <tr className="hover:bg-surface-200/30 transition-colors" {...props} />,
        th: (props) => (
          <th className="border-r border-ink-900/10 px-3 py-2 text-left font-semibold text-ink-900 last:border-r-0" {...props} />
        ),
        td: (props) => (
          <td className="border-r border-ink-900/10 px-3 py-2 text-ink-700 last:border-r-0" {...props} />
        ),
      }}
      >
        {String(text ?? "")}
      </ReactMarkdown>
    </div>
  );
};

// Memoize to prevent unnecessary re-renders when parent state changes (e.g., copy button)
export default memo(MDContentInternal);
