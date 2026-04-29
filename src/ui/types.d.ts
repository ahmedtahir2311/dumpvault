// Bun's HTML import — used by src/ui/server.ts to embed the SPA in the binary.
declare module '*.html' {
  const html: import('bun').BunFile | unknown;
  export default html;
}
