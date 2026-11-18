import { Check, Copy } from 'lucide-react'
import { isValidElement, useState, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      /* ignore */
    }
  }
  return (
    <div className="my-2 overflow-hidden rounded-lg border border-line bg-[#0b0f16]">
      <div className="flex items-center gap-2 border-b border-line bg-black/30 px-2.5 py-1">
        <span className="font-mono text-[9.5px] uppercase tracking-wider text-faint">{lang || 'code'}</span>
        <button
          type="button"
          onClick={() => void copy()}
          className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-[9.5px] text-faint transition-colors hover:bg-hover hover:text-ink"
        >
          {copied ? <Check size={10} className="text-ok" /> : <Copy size={10} />}
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre className="overflow-x-auto px-3 py-2 font-mono text-[11px] leading-[1.65] text-[#d6e2f0]">
        <code>{code}</code>
      </pre>
    </div>
  )
}

const components: Components = {
  pre({ children }) {
    const child = Array.isArray(children) ? children[0] : children
    if (isValidElement(child)) {
      const props = child.props as { className?: string; children?: ReactNode }
      const code = String(props.children ?? '').replace(/\n$/, '')
      const lang = /language-([\w-]+)/.exec(props.className ?? '')?.[1]
      return <CodeBlock code={code} lang={lang} />
    }
    return <pre className="overflow-x-auto">{children}</pre>
  },
  code({ children, className }) {
    if (className) return <code className="font-mono">{children}</code>
    return (
      <code className="rounded border border-line bg-hover px-1 py-px font-mono text-[11.5px] text-accent2">
        {children}
      </code>
    )
  },
  p({ children }) {
    return <p className="my-1.5 first:mt-0 last:mb-0">{children}</p>
  },
  h1({ children }) {
    return <h1 className="mb-1.5 mt-3 text-[15px] font-semibold text-ink first:mt-0">{children}</h1>
  },
  h2({ children }) {
    return <h2 className="mb-1.5 mt-3 text-[13.5px] font-semibold text-ink first:mt-0">{children}</h2>
  },
  h3({ children }) {
    return <h3 className="mb-1 mt-2.5 text-[12.5px] font-semibold text-ink first:mt-0">{children}</h3>
  },
  ul({ children }) {
    return <ul className="my-1.5 list-disc space-y-1 pl-5 marker:text-faint">{children}</ul>
  },
  ol({ children }) {
    return <ol className="my-1.5 list-decimal space-y-1 pl-5 marker:text-faint">{children}</ol>
  },
  li({ children }) {
    return <li className="pl-0.5">{children}</li>
  },
  a({ href, children }) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="text-accent2 underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
      >
        {children}
      </a>
    )
  },
  blockquote({ children }) {
    return (
      <blockquote className="my-2 border-l-2 border-accent/40 bg-accent/[0.04] py-1 pl-3 text-dim">
        {children}
      </blockquote>
    )
  },
  hr() {
    return <hr className="my-3 border-line" />
  },
  strong({ children }) {
    return <strong className="font-semibold text-ink">{children}</strong>
  },
  em({ children }) {
    return <em className="italic text-ink/85">{children}</em>
  },
  table({ children }) {
    return (
      <div className="my-2 overflow-x-auto rounded-lg border border-line">
        <table className="w-full border-collapse text-[11px]">{children}</table>
      </div>
    )
  },
  thead({ children }) {
    return <thead className="bg-soft text-faint">{children}</thead>
  },
  th({ children }) {
    return <th className="border-b border-line px-2.5 py-1.5 text-left font-medium">{children}</th>
  },
  td({ children }) {
    return <td className="border-b border-line/60 px-2.5 py-1.5 align-top">{children}</td>
  },
  tr({ children }) {
    return <tr className="last:[&>td]:border-0">{children}</tr>
  },
}

export default function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown-body text-[12.5px] leading-[1.75] text-ink/90">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  )
}
