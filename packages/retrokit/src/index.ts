// Root export is the sim core only — safe to import from anywhere, including
// sim code. Renderer/input/loop live behind ./render, ./input, ./loop.
export * from './sim/index';
