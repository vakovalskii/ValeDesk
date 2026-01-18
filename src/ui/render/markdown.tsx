import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";

export default function MDContent({ text }: { text: string }) {
  const handleLinkClick = (href: string) => {
    if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
      window.electron.sendClientEvent({ type: "open.external", payload: { url: href } });
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
  )
}
