import { describe, expect, it } from 'vitest';
import { parseModerationVerdict } from './style-prompt.js';

/**
 * The moderation gate (ADR-004): a model verdict in, a safe/unsafe decision
 * out. The whole rejection path hinges on this being correct and FAILING
 * CLOSED — anything we can't read as an explicit `safe:true` is unsafe, so a
 * confused or truncated model reply rejects (→ the client gets a fallback,
 * never an unmoderated sprite).
 */
describe('parseModerationVerdict', () => {
  it('passes an explicit safe verdict', () => {
    expect(parseModerationVerdict('{"safe": true, "reason": "ok"}')).toEqual({ safe: true, reason: 'ok' });
  });

  it('rejects an explicit unsafe verdict, keeping the reason', () => {
    expect(parseModerationVerdict('{"safe": false, "reason": "nudity"}')).toEqual({ safe: false, reason: 'nudity' });
  });

  it('reads a verdict out of fenced or chatty replies', () => {
    expect(parseModerationVerdict('```json\n{"safe": true, "reason": ""}\n```').safe).toBe(true);
    expect(parseModerationVerdict('Sure! Here you go: {"safe": true, "reason": "fine"} — hope that helps').safe).toBe(true);
  });

  it('fails closed on anything not explicitly safe', () => {
    expect(parseModerationVerdict('no json here').safe).toBe(false); // unparseable
    expect(parseModerationVerdict('{bad json}').safe).toBe(false); // invalid JSON
    expect(parseModerationVerdict('{"safe": "yes"}').safe).toBe(false); // non-boolean
    expect(parseModerationVerdict('{"reason": "missing field"}').safe).toBe(false); // no `safe`
    expect(parseModerationVerdict('').safe).toBe(false); // empty
  });
});
