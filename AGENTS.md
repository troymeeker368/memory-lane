# Memory Lane Development Rules

- Always run the local app on `http://localhost:3001`.
- Do not switch to another port just because `3001` is busy.
- If `3001` is occupied, identify the process using it and stop that process before starting the app.
- Before edits, run `git status`.
- After edits, run `npm run typecheck`.
- After significant edits, run `npm run build`.
- Summarize changed files and any remaining issues at the end.

## Port Utilities (Windows)

- Optional helper: `npm run dev:clean`
  - Frees port `3001` and then starts the app on `3001`.
  - Use this when a stuck Next.js dev server is blocking startup.
- If PowerShell blocks `npx` scripts:
  - Run `npm run dev:clean` from Command Prompt.
  - Or manually clear the port:
    - `netstat -ano | findstr :3001`
    - `taskkill /PID <PID> /F`
