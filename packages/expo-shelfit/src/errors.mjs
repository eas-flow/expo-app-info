// CliError (user-facing input/usage mistakes) and ApiError (EAS API
// failures) live together here so args.mjs / shared/filter.mjs /
// shared/api.mjs can throw them without importing back through cli.mjs.
export class CliError extends Error {}
export class ApiError extends Error {}
