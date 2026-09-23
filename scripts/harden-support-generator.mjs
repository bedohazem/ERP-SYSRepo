import path from 'node:path'
import { flipFuses, FuseVersion, FuseV1Options } from '@electron/fuses'

const executablePath = path.resolve(
  'tools',
  'release',
  'ERP Support Generator-win32-x64',
  'ERP Support Generator.exe',
)

await flipFuses(executablePath, {
  version: FuseVersion.V1,

  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableCookieEncryption]: true,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
})

console.log('Hardened ERP Support Generator Electron fuses')
