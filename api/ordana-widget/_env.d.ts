// Vercel functions run on Node; this is all we use from it (no @types/node needed).
declare const process: { env: Record<string, string | undefined> }
