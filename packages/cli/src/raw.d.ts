// `import text from './file?raw'`: the file's contents as a string. Vitest does this natively;
// scripts/build.ts does it for the bundle.
declare module '*?raw' {
  const text: string
  export default text
}
