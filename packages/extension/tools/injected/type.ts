import type { SelectorSpec } from '../selector-spec.js';

export type InjectedTypeResult = { success: true } | { success: false; error: string; hint?: string };

export const injectedType = async (
  spec: SelectorSpec | null,
  value: string,
  waitMs: number,
): Promise<InjectedTypeResult> => {
  // Inline resolveSelectorSpecElement to avoid new Function reconstruction on CSP-strict pages
  const resolveSelectorSpecElement = (
    selectorSpec: { kind: string; selector?: string; xpath?: string; text?: string; base?: string },
    allowDeepSearch: boolean,
  ) => {
    const isVisible = (el: HTMLElement) => {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      if (Number.parseFloat(style.opacity || '1') === 0) return false;
      return true;
    };
    const normalizeText = (v: string) => v.replace(/\s+/g, ' ').trim().toLowerCase();
    const deepQuerySelectorAll = (css: string, maxNodes = 25000): HTMLElement[] => {
      const out: HTMLElement[] = [];
      let parsedOk = true;
      try {
        document.querySelector(css);
      } catch {
        parsedOk = false;
      }
      if (!parsedOk) return out;
      const stack: Array<Document | ShadowRoot | Element> = [document];
      let visited = 0;
      while (stack.length && visited < maxNodes) {
        const node = stack.pop()!;
        if (node instanceof Element) {
          visited += 1;
          try {
            if (node.matches(css)) out.push(node as HTMLElement);
          } catch {}
          const sr = (node as any).shadowRoot as ShadowRoot | null | undefined;
          if (sr) stack.push(sr);
          for (const child of Array.from(node.children)) stack.push(child);
        } else {
          const children = node instanceof Document ? [node.documentElement] : Array.from(node.children);
          for (const child of children) if (child) stack.push(child);
        }
      }
      return out;
    };
    const findByText = (text: string, baseSelector = '', allowDeepSearch2 = true) => {
      const wanted = normalizeText(text);
      if (!wanted) return { el: null, candidates: 0 };
      const preferred = baseSelector
        ? (() => {
            try {
              return Array.from(document.querySelectorAll<HTMLElement>(baseSelector));
            } catch {
              return allowDeepSearch2 ? deepQuerySelectorAll(baseSelector) : [];
            }
          })()
        : Array.from(document.querySelectorAll<HTMLElement>('a, button, input, [role="button"], [role="link"]'));
      const pool = preferred.length > 0 ? preferred : Array.from(document.querySelectorAll<HTMLElement>('body *'));
      let best: HTMLElement | null = null;
      let bestScore = -1;
      let seen = 0;
      for (const el of pool) {
        if (!(el instanceof HTMLElement) || !isVisible(el)) continue;
        const txt = normalizeText(el.innerText || el.textContent || '');
        if (!txt || !txt.includes(wanted)) continue;
        seen += 1;
        const tag = el.tagName.toLowerCase();
        let score = 1;
        if (tag === 'button') score += 4;
        if (tag === 'a') score += 3;
        if (tag === 'input') score += 2;
        if (el.getAttribute('role') === 'button') score += 2;
        if (score > bestScore) {
          best = el;
          bestScore = score;
        }
      }
      return { el: best, candidates: seen };
    };
    if (!selectorSpec) return { el: null, strategy: 'none', candidates: 0, error: 'Missing selector.' };
    if (selectorSpec.kind === 'xpath') {
      const expr = String(selectorSpec.xpath || '').trim();
      if (!expr) return { el: null, strategy: 'xpath', candidates: 0, error: 'Missing XPath.' };
      try {
        const res = document.evaluate(expr, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        const node = res.singleNodeValue as HTMLElement | null;
        if (node && node instanceof HTMLElement) return { el: node, strategy: 'xpath', candidates: 1 };
        return { el: null, strategy: 'xpath', candidates: 0, error: 'Element not found.' };
      } catch (error: any) {
        return {
          el: null,
          strategy: 'xpath',
          candidates: 0,
          error: 'Invalid selector.',
          hint: `XPath failed: ${error?.message || String(error)}`,
        };
      }
    }
    if (selectorSpec.kind === 'text') {
      const { el, candidates } = findByText(selectorSpec.text || '', '', allowDeepSearch);
      return el
        ? { el, strategy: 'text', candidates }
        : { el: null, strategy: 'text', candidates, error: 'Element not found.' };
    }
    if (selectorSpec.kind === 'contains') {
      const { el, candidates } = findByText(selectorSpec.text || '', selectorSpec.base || '', allowDeepSearch);
      return el
        ? { el, strategy: 'contains/text', candidates }
        : { el: null, strategy: 'contains', candidates, error: 'Element not found.' };
    }
    const css = String(selectorSpec.selector || '').trim();
    if (!css) return { el: null, strategy: 'css', candidates: 0, error: 'Missing selector.' };
    try {
      const matches = Array.from(document.querySelectorAll<HTMLElement>(css));
      const visible = matches.filter(isVisible);
      const el = visible[0] || matches[0] || null;
      if (el) return { el, strategy: 'css', candidates: matches.length };
    } catch (error: any) {
      return {
        el: null,
        strategy: 'css',
        candidates: 0,
        error: 'Invalid selector.',
        hint: `querySelector failed: ${error?.message || String(error)}`,
      };
    }
    if (allowDeepSearch) {
      const deep = deepQuerySelectorAll(css);
      const deepVisible = deep.filter(isVisible);
      const el = deepVisible[0] || deep[0] || null;
      if (el) return { el, strategy: 'css(deep)', candidates: deep.length };
    }
    return { el: null, strategy: 'css', candidates: 0, error: 'Element not found.' };
  };

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const pollIntervalMs = 200;
  const isVisible = (el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    return true;
  };
  const safeQueryAll = (css: string) => {
    try {
      return Array.from(document.querySelectorAll<HTMLElement>(css));
    } catch {
      return [] as HTMLElement[];
    }
  };
  const resolveEditable = (candidate: HTMLElement | null) => {
    if (!candidate) return null;
    if (
      candidate instanceof HTMLInputElement ||
      candidate instanceof HTMLTextAreaElement ||
      (candidate as HTMLElement).isContentEditable
    )
      return candidate;
    const descendant =
      candidate.querySelector<HTMLElement>(
        'textarea, input, [contenteditable="true"], [contenteditable=""], [role="textbox"]',
      ) || null;
    return descendant || null;
  };

  let el: HTMLElement | null = null;
  const deepQueryMinIntervalMs = 700;
  let lastDeepQueryAt = 0;
  const start = performance.now();
  const deadline = start + Math.max(0, waitMs || 0);
  while (performance.now() <= deadline) {
    if (spec) {
      const now = performance.now();
      const allowDeepSearch = now - lastDeepQueryAt >= deepQueryMinIntervalMs;
      if (allowDeepSearch) lastDeepQueryAt = now;
      const resolved = resolveSelectorSpecElement(spec as any, allowDeepSearch);
      if (resolved.error === 'Invalid selector.') {
        return { success: false, error: `${resolved.error} ${resolved.hint || ''}`.trim() };
      }
      el = resolveEditable(resolved.el);
    }
    if (!el) {
      const active = document.activeElement as HTMLElement | null;
      if (
        active &&
        (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active.isContentEditable)
      )
        el = active;
    }
    if (!el) {
      const candidates = safeQueryAll(
        'input, textarea, [contenteditable="true"], [contenteditable=""], [role="textbox"]',
      );
      const fallback = candidates.find(isVisible) || candidates[0] || null;
      if (fallback) el = fallback;
    }
    if (el) break;
    await sleep(pollIntervalMs);
  }

  if (!el)
    return { success: false, error: 'Element not found.', hint: 'Try a more specific selector or increase timeoutMs.' };

  const dispatchInputEvents = (target: HTMLElement) => {
    try {
      target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    } catch {
      target.dispatchEvent(new Event('input', { bubbles: true }));
    }
    target.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const setNativeValue = (target: HTMLInputElement | HTMLTextAreaElement, nextValue: string) => {
    const proto = Object.getPrototypeOf(target);
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor?.set) descriptor.set.call(target, nextValue);
    else target.value = nextValue;
  };

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const inputType = el instanceof HTMLInputElement ? el.type : 'text';
    if (inputType === 'checkbox' || inputType === 'radio')
      return { success: false, error: 'Element is a checkbox/radio. Use click instead.' };
    try {
      el.scrollIntoView({ block: 'center', inline: 'center' } as any);
    } catch {}
    el.focus();
    if (typeof el.select === 'function') el.select();
    setNativeValue(el, value);
    dispatchInputEvents(el);
    return { success: true };
  }

  if ((el as HTMLElement).isContentEditable) {
    try {
      el.scrollIntoView({ block: 'center', inline: 'center' } as any);
    } catch {}
    el.focus();
    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
      const range = document.createRange();
      range.selectNodeContents(el);
      selection.addRange(range);
    }
    document.execCommand?.('insertText', false, value);
    if (el.textContent !== value) el.textContent = value;
    dispatchInputEvents(el);
    return { success: true };
  }

  return {
    success: false,
    error: 'Target is not an input or editable element.',
    hint: 'Use a selector that targets an <input>, <textarea>, or [contenteditable] node (or click to focus it first).',
  };
};
