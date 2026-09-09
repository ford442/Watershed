import {
  CAPTURE_ENVELOPE,
  DEGRADED_ENVELOPE,
  HARDWARE_ENVELOPE,
  getSessionGraphicsCapability,
  getSessionGraphicsEnvelope,
  negotiateBootGraphics,
  probeGraphicsCapability,
  resetSessionGraphicsCapability,
} from './probeGraphicsCapability';

// ---------------------------------------------------------------------------
// A canvas stub with just enough surface for the probe: creation-error events
// dispatched synchronously from getContext (which is how browsers do it), and a
// WEBGL_lose_context extension we can watch for.
// ---------------------------------------------------------------------------

interface ProbeLog {
  /** Attributes of every getContext call, in order. */
  attempts: WebGLContextAttributes[];
  /** How many probe contexts were explicitly released. */
  released: number;
  /** How many throwaway canvases the probe asked for. */
  canvases: number;
}

type ContextOutcome = { ok: true } | { ok: false; statusMessage?: string };

function createCanvasFactory(
  outcomes: (attributes: WebGLContextAttributes) => ContextOutcome
): { factory: () => HTMLCanvasElement; log: ProbeLog } {
  const log: ProbeLog = { attempts: [], released: 0, canvases: 0 };

  const factory = () => {
    log.canvases += 1;
    const listeners = new Set<(event: unknown) => void>();
    const canvas = {
      addEventListener(type: string, handler: (event: unknown) => void) {
        if (type === 'webglcontextcreationerror') listeners.add(handler);
      },
      removeEventListener(_type: string, handler: (event: unknown) => void) {
        listeners.delete(handler);
      },
      getContext(_type: string, attributes: WebGLContextAttributes) {
        log.attempts.push(attributes);
        const outcome = outcomes(attributes);
        if (outcome.ok) {
          return {
            getExtension: (name: string) =>
              name === 'WEBGL_lose_context'
                ? {
                    loseContext: () => {
                      log.released += 1;
                    },
                  }
                : null,
          };
        }
        for (const handler of listeners) {
          handler({ statusMessage: outcome.statusMessage });
        }
        return null;
      },
    };
    return canvas as unknown as HTMLCanvasElement;
  };

  return { factory, log };
}

/** Every request succeeds — a machine with a real GPU. */
const hardwareCanvas = () => createCanvasFactory(() => ({ ok: true }));

/** The caveat check is refused; anything else is granted. */
const degradedCanvas = (statusMessage = 'GPU process isn’t usable') =>
  createCanvasFactory((attributes) =>
    attributes.failIfMajorPerformanceCaveat ? { ok: false, statusMessage } : { ok: true }
  );

/** No WebGL2 at all. */
const deadCanvas = (statusMessage = 'WebGL is disabled') =>
  createCanvasFactory(() => ({ ok: false, statusMessage }));

beforeEach(() => {
  resetSessionGraphicsCapability();
  vi.restoreAllMocks();
});

describe('probeGraphicsCapability', () => {
  it('reports the hardware tier when the strict request succeeds', () => {
    const { factory, log } = hardwareCanvas();
    const capability = probeGraphicsCapability({ createCanvas: factory });

    expect(capability.tier).toBe('hardware');
    expect(capability.envelope).toEqual(HARDWARE_ENVELOPE);
    expect(capability.reason).toBe('hardware');
    expect(capability.statusMessage).toBeNull();
    // One attempt only — no reason to ask again once the optimistic one lands.
    expect(log.attempts).toHaveLength(1);
    expect(log.attempts[0].failIfMajorPerformanceCaveat).toBe(true);
    expect(log.attempts[0].powerPreference).toBe('high-performance');
  });

  it('falls to the degraded tier when only the relaxed request succeeds', () => {
    const { factory, log } = degradedCanvas('Passthrough is not supported');
    const capability = probeGraphicsCapability({ createCanvas: factory });

    expect(capability.tier).toBe('degraded');
    expect(capability.envelope).toEqual(DEGRADED_ENVELOPE);
    expect(capability.reason).toBe('caveat');
    // The strict attempt's statusMessage is the diagnostic worth keeping.
    expect(capability.statusMessage).toBe('Passthrough is not supported');
    expect(log.attempts).toHaveLength(2);
    expect(log.attempts[1].failIfMajorPerformanceCaveat).toBe(false);
    expect(log.attempts[1].powerPreference).toBe('default');
  });

  it('reports the unsupported tier and the browser status message when both fail', () => {
    const { factory, log } = deadCanvas('WebGL is disabled by policy');
    const capability = probeGraphicsCapability({ createCanvas: factory });

    expect(capability.tier).toBe('unsupported');
    expect(capability.reason).toBe('no-context');
    expect(capability.statusMessage).toBe('WebGL is disabled by policy');
    expect(log.attempts).toHaveLength(2);
    expect(log.released).toBe(0);
  });

  it.each([
    ['hardware', hardwareCanvas],
    ['degraded', degradedCanvas],
  ] as const)('releases every probe context it opened (%s)', (_name, makeFactory) => {
    const { factory, log } = makeFactory();
    probeGraphicsCapability({ createCanvas: factory });
    // The per-origin live-context limit is real: a leaked probe context costs
    // the game a slot for the whole session.
    expect(log.released).toBe(1);
  });

  it('uses a fresh throwaway canvas for each attempt', () => {
    const { factory, log } = degradedCanvas();
    probeGraphicsCapability({ createCanvas: factory });
    expect(log.canvases).toBe(2);
  });

  it('skips the optimistic attempt when asked to', () => {
    const { factory, log } = degradedCanvas();
    const capability = probeGraphicsCapability({
      createCanvas: factory,
      skipStrictAttempt: true,
    });

    expect(log.attempts).toHaveLength(1);
    expect(log.attempts[0].failIfMajorPerformanceCaveat).toBe(false);
    expect(capability.tier).toBe('degraded');
    expect(capability.reason).toBe('previous-boot-failed');
  });

  it('treats a missing DOM as unsupported rather than throwing', () => {
    const capability = probeGraphicsCapability({ createCanvas: () => null });
    expect(capability.tier).toBe('unsupported');
  });

  it('survives a getContext that throws', () => {
    const capability = probeGraphicsCapability({
      createCanvas: () =>
        ({
          addEventListener() {},
          removeEventListener() {},
          getContext() {
            throw new Error('blocked by extension');
          },
        }) as unknown as HTMLCanvasElement,
    });
    expect(capability.tier).toBe('unsupported');
    expect(capability.statusMessage).toBe('blocked by extension');
  });
});

describe('negotiateBootGraphics', () => {
  it('pins the capture envelope without probing', () => {
    const { factory, log } = deadCanvas();
    const capability = negotiateBootGraphics({ captureMode: true, createCanvas: factory });

    expect(capability.envelope).toEqual(CAPTURE_ENVELOPE);
    expect(capability.tier).toBe('hardware');
    expect(capability.reason).toBe('capture-mode');
    expect(capability.probed).toBe(false);
    // Probing here would flip antialias on SwiftShader and move every baseline.
    expect(log.attempts).toHaveLength(0);
  });

  it('skips the optimistic attempt after a boot that never got a steady frame', () => {
    const { factory, log } = degradedCanvas();
    const capability = negotiateBootGraphics({
      previousBootFailed: true,
      createCanvas: factory,
    });

    expect(log.attempts).toHaveLength(1);
    expect(capability.reason).toBe('previous-boot-failed');
  });

  it('publishes the session envelope so every derive call agrees', () => {
    expect(getSessionGraphicsCapability()).toBeNull();
    // Before negotiation, callers outside the game boot path get the
    // unsurprising answer rather than a degraded one.
    expect(getSessionGraphicsEnvelope()).toEqual(HARDWARE_ENVELOPE);

    const { factory } = degradedCanvas();
    negotiateBootGraphics({ createCanvas: factory });

    expect(getSessionGraphicsCapability()?.tier).toBe('degraded');
    expect(getSessionGraphicsEnvelope()).toEqual(DEGRADED_ENVELOPE);
  });
});
