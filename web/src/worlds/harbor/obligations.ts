import type { Job, Observation } from '../../contracts/harbor'

/**
 * Provisional counts read directly from the public snapshot's receipts and
 * voyages. They are telemetry, not a score: the API's result frame and a future
 * verifier own scoring.
 */
export interface Obligation {
  job: Job
  /** Units received at the destination by the due round, capped at demand. */
  onTime: number
  /** Units received after the due round. They are delivered but earn no on-time credit. */
  late: number
  /** Units loaded on voyages that have not arrived yet. */
  inTransit: number
  /** Units of demand not yet received or loaded. */
  outstanding: number
  status: 'met' | 'in_transit' | 'open' | 'missed'
}

export function obligations(observation: Observation): Obligation[] {
  return observation.jobs.map((job) => {
    let received = 0
    let late = 0
    for (const receipt of observation.receipts) {
      if (receipt.job_id !== job.id) continue
      if (receipt.round <= job.due_round) received += receipt.units
      else late += receipt.units
    }
    let inTransit = 0
    for (const voyage of observation.voyages) {
      if (voyage.arrival <= observation.round) continue
      for (const load of voyage.loads) if (load.job_id === job.id) inTransit += load.units
    }
    const onTime = Math.min(received, job.units)
    const outstanding = Math.max(0, job.units - onTime - late - inTransit)
    const closed = observation.episode_state === 'closed'
    // Arrivals due at round r settle before the round-r snapshot, so at the due round nothing more can count.
    const status: Obligation['status'] =
      onTime >= job.units
        ? 'met'
        : closed || observation.round >= job.due_round
          ? 'missed'
          : inTransit > 0
            ? 'in_transit'
            : 'open'
    return { job, onTime, late, inTransit, outstanding, status }
  })
}
