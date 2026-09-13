import { Pipe, PipeTransform } from '@angular/core'
import { DomSanitizer, SafeHtml } from '@angular/platform-browser'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

const renderer = new marked.Renderer()
const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Code blocks get a small action bar (copy / insert into terminal). The
// transcript component handles the clicks via event delegation.
renderer.code = (code: string, infostring: string | undefined): string => {
    const lang = (infostring ?? '').trim().split(/\s+/)[0]
    const langAttr = lang ? ` data-lang="${escapeHtml(lang)}"` : ''
    return `<div class="code-block"${langAttr}>` +
        `<div class="code-actions">` +
        (lang ? `<span class="code-lang">${escapeHtml(lang)}</span>` : '') +
        `<button type="button" class="code-action" data-action="copy" title="Copy">Copy</button>` +
        `<button type="button" class="code-action" data-action="insert" title="Type into the active terminal (without Enter)">Insert</button>` +
        `</div><pre><code>${escapeHtml(code)}</code></pre></div>`
}
renderer.link = (href: string, title: string | null | undefined, text: string): string => {
    const t = title ? ` title="${escapeHtml(title)}"` : ''
    return `<a href="${escapeHtml(href)}"${t} target="_blank" rel="noopener noreferrer">${text}</a>`
}

marked.use({ renderer, gfm: true, breaks: true })

// Tabby's renderer has Node integration – model output must never become live markup.
const purifyConfig = {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form', 'input', 'svg', 'math', 'img', 'video', 'audio'],
    FORBID_ATTR: ['style', 'onerror', 'onload'],
    ALLOWED_URI_REGEXP: /^(?:https?|mailto):/i,
    ADD_ATTR: ['target', 'data-action', 'data-lang'],
}

export function renderMarkdown (markdown: string): string {
    const html = marked.parse(markdown ?? '', { async: false }) as string
    return DOMPurify.sanitize(html, purifyConfig) as string
}

@Pipe({ name: 'aiMarkdown', pure: true })
export class MarkdownPipe implements PipeTransform {
    constructor (private sanitizer: DomSanitizer) {}

    transform (value: string | null | undefined): SafeHtml {
        if (!value) {
            return ''
        }
        try {
            return this.sanitizer.bypassSecurityTrustHtml(renderMarkdown(value))
        } catch (e) {
            console.warn('[ai-panel] markdown render failed', e)
            return this.sanitizer.bypassSecurityTrustHtml(`<pre>${escapeHtml(value)}</pre>`)
        }
    }
}
