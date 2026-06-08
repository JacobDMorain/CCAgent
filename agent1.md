  ---
  What was fixed (14 of 18 issues resolved)

  The document now has a single canonical task list (Part B), the Master Tracker mirrors it, Part A §12 explicitly
  defers to Part B, and the shared daemon-client package, port allocator, daemon crash recovery, streaming error
  handling, auth token lifecycle, settings store, concurrency limits, coverage thresholds, and provider URL verification
   are all properly specified. This is in much better shape.

  ---
  Remaining Issues

  1. Missing error codes in Task 2

  Several error codes are referenced by later tasks but never defined in the ErrorCodes const:

  ┌───────────────┬─────────────────────────────────┬────────────────────────────────────────────┐
  │ Referenced in │           Error code            │                   Status                   │
  ├───────────────┼─────────────────────────────────┼────────────────────────────────────────────┤
  │ Task 11       │ CCAGENT_PROXY_PORT_UNAVAILABLE  │ Not in Task 2                              │
  ├───────────────┼─────────────────────────────────┼────────────────────────────────────────────┤
  │ Task 13       │ CCAGENT_CLAUDE_NOT_FOUND        │ Not in Task 2 (only CLAUDE_MISSING exists) │
  ├───────────────┼─────────────────────────────────┼────────────────────────────────────────────┤
  │ Task 13       │ CCAGENT_CLAUDE_UNSUPPORTED      │ Not in Task 2                              │
  ├───────────────┼─────────────────────────────────┼────────────────────────────────────────────┤
  │ Task 14       │ CCAGENT_TASK_LIMIT              │ Not in Task 2                              │
  ├───────────────┼─────────────────────────────────┼────────────────────────────────────────────┤
  │ Task 14       │ CCAGENT_DAEMON_RECOVERED        │ Not in Task 2                              │
  ├───────────────┼─────────────────────────────────┼────────────────────────────────────────────┤
  │ Task 14       │ CCAGENT_DAEMON_AUTH_UNAVAILABLE │ Not in Task 2                              │
  └───────────────┴─────────────────────────────────┴────────────────────────────────────────────┘

  Add all six to the ErrorCodes constant in Task 2 so implementers don't invent their own variant strings.

  2. ReviewFileRequest differs between Part A and Part B

  Part A §5.2 (line 334–341):
  export interface ReviewFileRequest {
    provider: string;
    model?: string;
    cwd: string;
    file: string;
    reviewStyle?: "bugs" | "architecture" | "language" | "full";
    timeoutMs?: number;
    // no language, no maxOutputBytes
  }

  Part B Task 2 (line 1002–1011):
  export interface ReviewFileRequest {
    // ...
    reviewStyle?: ReviewStyle;
    language?: string;        // added
    timeoutMs?: number;
    maxOutputBytes?: number;  // added
  }

  Part B is canonical per the document's own rule, but an implementer reading Part A first could miss language and
  maxOutputBytes. Sync Part A §5.2 to match Part B, or add a note that Part B is the authoritative type definition.

  3. ccagent:// URI resolution is under-specified

  TaskResult.logsRef returns ccagent://tasks/<taskId>/logs, and Task 14 says it's resolved through GET /tasks/:id/logs.
  But it's unclear:

  - Is ccagent:// a custom protocol handler registered by the GUI? If so, no task covers the registration.
  - Or is it just an opaque identifier string that happens to look like a URI?

  If it's meant to be a clickable link in the GUI, add a bullet to Task 16 for registering the protocol handler. If it's
   just an identifier, rename it to something less URL-like (e.g., logsPath) to avoid confusion.

  4. Part A §3.1 references ccagent-storage but not ccagent-daemon-client

  The components list (line 186–192) enumerates every package except the new daemon-client. Trivial, but inconsistent
  with the updated repository layout in Part A §4 which does include it.

  5. Prompt template doesn't use the language field

  ReviewFileRequest now has an optional language field (Part B Task 2), but the review prompt template (Task 4, line
  1182–1199) still hardcodes "Return the result in Chinese unless the file itself clearly requires another language." It
   should use request.language when provided, falling back to Chinese.

  ---
  Summary

  The document is now implementation-ready. The five remaining issues are all small — missing error code definitions,
  one stale type definition in Part A, an under-specified URI scheme, a missing package in the component list, and the
  language field not wired into the prompt template. None are architectural concerns. Fix those and it's good to go.