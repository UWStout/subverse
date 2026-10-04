import morgan from 'morgan'

/**
 * Access log middleware for the API server.
 *
 * Logs one line per request in classic web-server access-log style, e.g.:
 *   2026-10-03T20:37:00.123Z GET /auth/me 200 15 ms ip=192.168.1.10
 *
 * Mount this in server.js BEFORE the route handlers so every request -
 * including 401/404/500 responses - gets a line. The status code and timing
 * are captured when the response finishes, so failed requests are logged too.
 *
 * Disabled entirely under NODE_ENV=test to keep test output clean.
 */
export const accessLog = morgan(
  ':date[iso] :method :url :status :response-time ms ip=:remote-addr',
  {
    // Route through console so output lands on stdout like everything else;
    // trim morgan's trailing newline to avoid blank lines.
    stream: { write: (msg) => console.log(msg.trimEnd()) },
    skip: () => process.env.NODE_ENV === 'test'
  }
)
