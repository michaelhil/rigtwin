// Bun imports TOML files natively (runtime and bundler); tools/bundle.ts replaces runtime-person.toml by its values.
declare module "*.toml" { const value: any; export default value; }
