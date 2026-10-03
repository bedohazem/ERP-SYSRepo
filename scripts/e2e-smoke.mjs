import { spawn } from 'node:child_process'

import { mkdtemp, rm } from 'node:fs/promises'

import os from 'node:os'

import path from 'node:path'

import { fileURLToPath } from 'node:url'

import electronPath from 'electron'

const currentFile = fileURLToPath(import.meta.url)

const scriptsDir = path.dirname(currentFile)

const projectRoot = path.resolve(scriptsDir, '..')

const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'erp-e2e-'))

let child = null

let output = ''

function appendOutput(chunk) {
  const text = String(chunk || '')

  output += text

  process.stdout.write(text)
}

try {
  console.log('Starting ERP Electron E2E smoke...')

  child = spawn(electronPath, ['.'], {
    cwd: projectRoot,

    windowsHide: true,

    env: {
      ...process.env,

      NODE_ENV: 'production',

      ERP_E2E_SMOKE: '1',

      ERP_E2E_USER_DATA_DIR: userDataDir,

      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    },

    stdio: ['ignore', 'pipe', 'pipe'],
  })

  child.stdout?.setEncoding('utf8')

  child.stderr?.setEncoding('utf8')

  child.stdout?.on('data', appendOutput)

  child.stderr?.on('data', appendOutput)

  const exitResult = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (child && child.exitCode === null) {
        child.kill()
      }

      reject(new Error(['ERP E2E smoke timed out.', '', output].join('\n')))
    }, 30_000)

    child.on('error', (error) => {
      clearTimeout(timeout)

      reject(error)
    })

    child.on('exit', (code, signal) => {
      clearTimeout(timeout)

      resolve({
        code,
        signal,
      })
    })
  })

  if (exitResult.code !== 0) {
    throw new Error(
      [
        `ERP E2E exited with code ${exitResult.code}.`,
        `Signal: ${exitResult.signal || 'none'}`,
        '',
        output,
      ].join('\n'),
    )
  }

  if (!output.includes('ERP_E2E_SMOKE_READY')) {
    throw new Error(
      ['Electron exited without the E2E ready marker.', '', output].join('\n'),
    )
  }

  console.log('ERP Electron E2E smoke passed.')
} finally {
  if (child && child.exitCode === null) {
    child.kill()
  }

  await rm(userDataDir, {
    recursive: true,
    force: true,
  })
}
