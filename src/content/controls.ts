// glowficlog content-script controls module. Builds the floating control cluster
// (spanner + toggle) as a detached DOM subtree. No extension-API calls here —
// all event handlers are injected so this module is testable in jsdom without a
// browser host. reflect() is the single source of truth for visual state.

export interface ControlsHandlers {
  onToggle(): void;
  onOpenOptions(): void;
}

export interface Controls {
  readonly container: HTMLElement;
  readonly toggle: HTMLButtonElement;
  readonly spanner: HTMLButtonElement;
  reflect(enabled: boolean): void;
}

export function createControls(doc: Document, handlers: ControlsHandlers): Controls {
  const container = doc.createElement('div');
  container.className = 'glr-controls';

  // Spanner sits FIRST (leftmost in the flex row) and is hidden until enabled.
  const spanner = doc.createElement('button');
  spanner.className = 'glr-spanner';
  spanner.type = 'button';
  spanner.textContent = '🔧';
  spanner.setAttribute('aria-label', 'glowficlog options');
  spanner.title = 'glowficlog options';
  spanner.hidden = true; // reader starts OFF; shown only when enabled via reflect()
  spanner.addEventListener('click', () => handlers.onOpenOptions());

  const toggle = doc.createElement('button');
  toggle.className = 'glr-toggle';
  toggle.type = 'button';
  toggle.setAttribute('aria-pressed', 'false');
  toggle.addEventListener('click', () => handlers.onToggle());

  container.appendChild(spanner);
  container.appendChild(toggle);

  function reflect(enabled: boolean): void {
    toggle.setAttribute('aria-pressed', String(enabled));
    const label = enabled ? '📖 Glowlog: on' : '📖 Glowlog: off';
    toggle.textContent = label;
    toggle.setAttribute('aria-label', label);
    toggle.title = enabled
      ? 'Glowlog is on (Alt+G to toggle)'
      : 'Show the Glowlog compact reader (Alt+G)';
    spanner.hidden = !enabled;
  }

  return { container, toggle, spanner, reflect };
}
