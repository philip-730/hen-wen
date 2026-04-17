'use client'

import { useState, useRef, useEffect, memo } from 'react'
import { flushSync } from 'react-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ChevronDown, ChevronUp, Send } from 'lucide-react'
import { DataChart, type ChartSpec } from '@/components/data-chart'

const CHAR_DELAY_MS = 12

interface Message {
  role: 'user' | 'assistant'
  content: string
  sql?: string
  rows?: Record<string, string>[]
  totalRows?: number
  charts?: ChartSpec[]
}

const PREVIEW_ROWS = 10

function SqlPill({ sql, rows, totalRows }: { sql: string; rows?: Record<string, string>[]; totalRows?: number }) {
  const [open, setOpen] = useState(false)
  const columns = rows && rows.length > 0 ? Object.keys(rows[0]) : []
  const preview = rows?.slice(0, PREVIEW_ROWS) ?? []

  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <Badge variant="outline" className="font-mono text-xs">SQL</Badge>
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <pre className="p-3 bg-background border rounded-md text-xs font-mono overflow-x-auto whitespace-pre-wrap">
            {sql}
          </pre>
          {preview.length > 0 && (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-background/50">
                    {columns.map(col => (
                      <th key={col} className="px-3 py-1.5 text-left font-medium text-muted-foreground whitespace-nowrap">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.map((row, i) => (
                    <tr key={i} className="border-b last:border-0 hover:bg-background/30">
                      {columns.map(col => (
                        <td key={col} className="px-3 py-1.5 whitespace-nowrap max-w-[200px] truncate">
                          {row[col] ?? '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {totalRows !== undefined && totalRows > PREVIEW_ROWS && (
                <p className="px-3 py-1.5 text-xs text-muted-foreground border-t">
                  Showing {PREVIEW_ROWS} of {totalRows} rows
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const AssistantMessage = memo(function AssistantMessage({ content, sql, rows, totalRows, charts, isStreaming }: { content: string; sql?: string; rows?: Record<string, string>[]; totalRows?: number; charts?: ChartSpec[]; isStreaming: boolean }) {
  return (
    <div className="w-full overflow-hidden rounded-2xl px-4 py-2.5 text-sm bg-muted text-foreground">
      {content
        ? (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
              h1: ({ children }) => <h1 className="text-base font-semibold mt-3 mb-1 first:mt-0">{children}</h1>,
              h2: ({ children }) => <h2 className="text-sm font-semibold mt-3 mb-1 first:mt-0">{children}</h2>,
              h3: ({ children }) => <h3 className="text-sm font-semibold mt-2 mb-1 first:mt-0">{children}</h3>,
              ul: ({ children }) => <ul className="mb-2 space-y-0.5 pl-4 list-disc">{children}</ul>,
              ol: ({ children }) => <ol className="mb-2 space-y-0.5 pl-4 list-decimal">{children}</ol>,
              li: ({ children }) => <li className="leading-relaxed">{children}</li>,
              strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
              code: ({ children }) => <code className="text-xs bg-background px-1 py-0.5 rounded font-mono">{children}</code>,
              pre: ({ children }) => <pre className="text-xs bg-background p-2 rounded overflow-x-auto my-2">{children}</pre>,
              table: ({ children }) => <table className="text-xs w-full my-2 border-collapse">{children}</table>,
              th: ({ children }) => <th className="text-left font-semibold border-b border-border pb-1 pr-3">{children}</th>,
              td: ({ children }) => <td className="border-b border-border/40 py-1 pr-3">{children}</td>,
            }}
          >{content}</ReactMarkdown>
        )
        : isStreaming
          ? <span className="text-muted-foreground animate-pulse">···</span>
          : null}
      {charts && rows && charts.map((chart, i) => <DataChart key={i} spec={chart} rows={rows} />)}
      {sql && <SqlPill sql={sql} rows={rows} totalRows={totalRows} />}
    </div>
  )
})

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const latestAssistantRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const charQueue = useRef<string[]>([])
  const animating = useRef(false)
  const prevMessageCount = useRef(0)

  useEffect(() => {
    if (messages.length > prevMessageCount.current) {
      prevMessageCount.current = messages.length
      latestAssistantRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [messages])

  function drainQueue(index: number) {
    if (charQueue.current.length === 0) {
      animating.current = false
      return
    }
    const char = charQueue.current.shift()!
    flushSync(() => {
      setMessages(prev => {
        const updated = [...prev]
        updated[index] = { ...updated[index], content: updated[index].content + char }
        return updated
      })
    })
    setTimeout(() => drainQueue(index), CHAR_DELAY_MS)
  }

  function enqueue(text: string, index: number) {
    charQueue.current.push(...text.split(''))
    if (!animating.current) {
      animating.current = true
      drainQueue(index)
    }
  }

  async function send() {
    if (!input.trim() || loading) return

    const userMessage = input.trim()
    setInput('')
    setLoading(true)
    setStatus(null)
    charQueue.current = []
    animating.current = false

    const history = messages.map(m => ({ role: m.role, content: m.content }))

    setMessages(prev => [
      ...prev,
      { role: 'user', content: userMessage },
      { role: 'assistant', content: '' },
    ])

    const assistantIndex = messages.length + 1

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage, history }),
      })

      if (!res.ok || !res.body) throw new Error('Network error')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const event = JSON.parse(line.slice(6))

          if (event.type === 'status') {
            setStatus(event.message)
          } else if (event.type === 'token') {
            enqueue(event.content, assistantIndex)
          } else if (event.type === 'sql') {
            setMessages(prev => {
              const updated = [...prev]
              updated[assistantIndex] = { ...updated[assistantIndex], sql: event.content }
              return updated
            })
          } else if (event.type === 'rows') {
            setMessages(prev => {
              const updated = [...prev]
              updated[assistantIndex] = { ...updated[assistantIndex], rows: event.rows, totalRows: event.total }
              return updated
            })
          } else if (event.type === 'chart') {
            setMessages(prev => {
              const updated = [...prev]
              updated[assistantIndex] = { ...updated[assistantIndex], charts: event.configs }
              return updated
            })
          } else if (event.type === 'error') {
            setMessages(prev => {
              const updated = [...prev]
              updated[assistantIndex] = { ...updated[assistantIndex], content: `Error: ${event.message}` }
              return updated
            })
            setStatus(null)
            setLoading(false)
          } else if (event.type === 'done') {
            setStatus(null)
            setLoading(false)
          }
        }
      }
    } catch {
      setMessages(prev => {
        const updated = [...prev]
        updated[assistantIndex] = { ...updated[assistantIndex], content: 'Something went wrong. Is the backend running?' }
        return updated
      })
      setStatus(null)
      setLoading(false)
    }

    inputRef.current?.focus()
  }

  return (
    <div className="flex flex-col h-screen">
      <header className="shrink-0 border-b px-6 py-4">
        <h1 className="font-semibold">Hen Wen</h1>
        <p className="text-xs text-muted-foreground">banzai-pipeline.pokemon.all · BigQuery</p>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-6 py-4">
        <div className="max-w-3xl mx-auto space-y-4">
          {messages.length === 0 && (
            <p className="text-center text-sm text-muted-foreground py-16">
              Ask a question about Pokemon
            </p>
          )}
          {messages.map((msg, i) => (
            <div key={i} ref={msg.role === 'assistant' && i === messages.length - 1 ? latestAssistantRef : undefined} className={`flex min-w-0 w-full ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.role === 'user'
                ? (
                  <div className="max-w-[80%] rounded-2xl px-4 py-2.5 text-sm bg-primary text-primary-foreground">
                    {msg.content}
                  </div>
                )
                : (
                  <AssistantMessage
                    content={msg.content}
                    sql={msg.sql}
                    rows={msg.rows}
                    totalRows={msg.totalRows}
                    charts={msg.charts}
                    isStreaming={loading && i === messages.length - 1}
                  />
                )}
            </div>
          ))}
          {status && (
            <p className="text-center text-xs text-muted-foreground animate-pulse">{status}</p>
          )}

        </div>
      </div>

      <div className="shrink-0 border-t px-6 py-4">
        <div className="max-w-3xl mx-auto flex gap-2">
          <Input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
            placeholder="Ask about Pokemon, types, stats, generations..."
            disabled={loading}
            className="flex-1"
          />
          <Button onClick={send} disabled={loading || !input.trim()} size="icon">
            <Send size={16} />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground text-center mt-2">
          AI-generated SQL · always verify results
        </p>
      </div>
    </div>
  )
}
