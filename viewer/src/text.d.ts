// Bun imports text files with `with { type: "text" }` (the credits page of the person panel bundles assets/manikin/CREDITS.md).
declare module "*.md" { const text: string; export default text; }
