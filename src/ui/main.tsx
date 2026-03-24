import { StrictMode, Component } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

window.addEventListener('error', (e) => {
  console.error('[main] window.onerror:', e.message, e.filename + ':' + e.lineno, e.error);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[main] unhandledrejection:', e.reason);
});

class RootErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error('[RootErrorBoundary] caught:', error.message);
    console.error('[RootErrorBoundary] stack:', error.stack);
    console.error('[RootErrorBoundary] component stack:', info.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, color: 'red', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
          <b>React crashed:</b>{'\n'}{this.state.error.message}{'\n'}{this.state.error.stack}
        </div>
      );
    }
    return this.props.children;
  }
}

// Debug: monitor Dialog.Content and track ANY attribute changes on html/body
let __prevDialogHeight = -1;
setInterval(() => {
  const dc = document.querySelector('[role="dialog"]') as HTMLElement;
  if (!dc) {
    if (__prevDialogHeight !== -1) {
      console.error('[DEBUG] Dialog DISAPPEARED from DOM! Was height:', __prevDialogHeight);
      console.error('[DEBUG] document.body children:', document.body.innerHTML.substring(0, 300));
    }
    __prevDialogHeight = -1;
    return;
  }
  const r = dc.getBoundingClientRect();
  if (r.height !== __prevDialogHeight) {
    console.warn(`[DEBUG] Dialog size changed: ${__prevDialogHeight} -> ${r.height}  (w=${r.width} top=${r.top})`);
    __prevDialogHeight = r.height;
    if (r.height < 50) {
      console.error('[DEBUG] Dialog COLLAPSED! Checking parents...');
      let el: HTMLElement | null = dc;
      while (el) {
        const pr = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        console.error(`  ${el.tagName}#${el.id} ${pr.width}x${pr.height} overflow=${cs.overflow} display=${cs.display} visibility=${cs.visibility} opacity=${cs.opacity}`);
        el = el.parentElement;
      }
    }
  }
  // Check scrollTop on dialog and ALL scrollable/overflow ancestors
  if (dc.scrollTop !== 0) {
    console.error(`[DEBUG] *** Dialog scrollTop is NON-ZERO: ${dc.scrollTop} *** scrollHeight=${dc.scrollHeight} clientHeight=${dc.clientHeight}`);
    // Auto-fix: reset it
    dc.scrollTop = 0;
  }
  // Check all children with overflow for unexpected scrollTop
  dc.querySelectorAll('*').forEach((child) => {
    const el = child as HTMLElement;
    if (el.scrollTop > 0 && el.scrollHeight > el.clientHeight) {
      const cs = getComputedStyle(el);
      if (cs.overflow === 'hidden') {
        console.error(`[DEBUG] *** overflow:hidden child has scrollTop=${el.scrollTop} ***`, el.tagName, el.className.substring(0, 60));
        el.scrollTop = 0;
      }
    }
  });
  // Also check parent chain of dialog for scrollTop
  let parent = dc.parentElement;
  while (parent) {
    if (parent.scrollTop !== 0) {
      console.error(`[DEBUG] *** Parent scrollTop=${parent.scrollTop} ***`, parent.tagName, parent.id, parent.className.substring(0, 60));
    }
    parent = parent.parentElement;
  }
}, 150);

// Track ALL attribute changes on html and body
const __attrObserver = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    const el = mutation.target as HTMLElement;
    const tag = el.tagName?.toLowerCase();
    if (tag === 'html' || tag === 'body') {
      console.warn(`[DEBUG] <${tag}> attr "${mutation.attributeName}" changed:`,
        `old="${(mutation.oldValue ?? '').substring(0, 80)}"`,
        `new="${(el.getAttribute(mutation.attributeName!) ?? '').substring(0, 80)}"`);
    }
  }
});
__attrObserver.observe(document.documentElement, {
  attributes: true,
  subtree: false,
  attributeOldValue: true,
});
__attrObserver.observe(document.body, {
  attributes: true,
  subtree: false,
  attributeOldValue: true,
});

createRoot(document.getElementById('root')!).render(
	<StrictMode>
		<RootErrorBoundary>
			<App />
		</RootErrorBoundary>
	</StrictMode>
)
