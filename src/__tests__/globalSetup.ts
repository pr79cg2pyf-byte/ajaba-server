/**
 * Vitest global setup — start Ajaba server before integration tests.
 * Builds the project first, then starts the compiled server.
 */
import { spawn, type ChildProcess, execSync } from 'child_process'
import { resolve } from 'path'

let server: ChildProcess | null = null

export async function setup() {
  const cwd = process.cwd()
  const serverFile = resolve(cwd, 'dist', 'server.js')

  // Build first so compiled JS is up to date
  try {
    execSync('npx tsc', { cwd, stdio: 'pipe', timeout: 30_000 })
  } catch {
    // Build may already be done from prior run — try existing dist
  }

  return new Promise<void>((resolvePromise, reject) => {
    server = spawn('node', [serverFile], {
      env: { ...process.env, PORT: '8787', NODE_ENV: 'test' },
      stdio: 'pipe',
    })

    const timeout = setTimeout(() => {
      reject(new Error('Server failed to start within 10 seconds'))
    }, 10_000)

    let started = false
    const onData = (data: Buffer) => {
      const msg = data.toString()
      if (!started && (msg.includes('running') || msg.includes('listening'))) {
        started = true
        clearTimeout(timeout)
        resolvePromise()
      }
    }

    server.stdout?.on('data', onData)
    server.stderr?.on('data', onData)

    server.on('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })

    server.on('exit', (code) => {
      if (!started && code !== null && code !== 0) {
        clearTimeout(timeout)
        reject(new Error(`Server exited with code ${code}`))
      }
    })
  })
}

export async function teardown() {
  if (server) {
    server.kill('SIGTERM')
    server = null
  }
}
