export type DownloadPollingState = {
  active: boolean
  visible: boolean
  inFlight: boolean
  requested: boolean
}

export const createDownloadPollingState = (): DownloadPollingState => ({
  active: false,
  visible: true,
  inFlight: false,
  requested: false,
})

/** Coalesce any number of stale-event requests into one pending reconciliation. */
export const requestDownloadReconciliation = (
  state: DownloadPollingState,
): DownloadPollingState => ({ ...state, requested: true })

export const setDownloadPollingActive = (
  state: DownloadPollingState,
  active: boolean,
): DownloadPollingState => ({ ...state, active })

export const setDownloadPollingVisible = (
  state: DownloadPollingState,
  visible: boolean,
): DownloadPollingState => ({ ...state, visible })

export const canStartDownloadReconciliation = (state: DownloadPollingState) => (
  state.visible
  && !state.inFlight
  && (state.active || state.requested)
)

export const startDownloadReconciliation = (state: DownloadPollingState) => (
  canStartDownloadReconciliation(state)
    ? { started: true, state: { ...state, inFlight: true, requested: false } }
    : { started: false, state }
)

export const finishDownloadReconciliation = (
  state: DownloadPollingState,
): DownloadPollingState => ({ ...state, inFlight: false })
