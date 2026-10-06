import type { NcmBridge } from '@shared/ipc'

declare global {
  interface Window {
    ncm: NcmBridge
    ncmEvents: typeof import('@shared/ipc').IPC_EVENT
  }
}

export {}
