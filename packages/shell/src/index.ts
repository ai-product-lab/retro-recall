/**
 * @retro-recall/shell — the mobile-first arcade shell (ADR-007), shared across
 * games so the touch/layout idiom is authored once. Extracted from Bubble
 * Buddies once a second game (Splash Squad) needed the same dual-orientation
 * layout engine and 8-way touch pad (ADR-009: shared surfaces land on main).
 *
 * Generic only: the layout engine, the touch controls, and capability
 * detection. Game-specific shell (audio, PWA, comms, invite, emote UI) stays in
 * each game. CSS for the controls still lives in each game's shell.css for now —
 * extracting a shared stylesheet is a tracked follow-up.
 */
export * from './layout';
export * from './controls';
export * from './device';
export * from './gestures';
export * from './touch';
export * from './audio';
