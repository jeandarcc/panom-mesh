import { describe, expect, it } from 'vitest'
import { ActiveConnectionTracker } from '../src/drain/ActiveConnectionTracker.js'

describe('ActiveConnectionTracker', () => {
  it('tracks HTTP work and waits until idle', async () => {
    const tracker = new ActiveConnectionTracker()
    const end = tracker.beginHttp('api-a')
    expect(tracker.snapshot().total.total).toBe(1)
    let resolved = false
    const idle = tracker.waitForIdle(500).then(value => { resolved = value; return value })
    await Promise.resolve()
    expect(resolved).toBe(false)
    end()
    expect(await idle).toBe(true)
    expect(tracker.snapshot().total.total).toBe(0)
  })

  it('times out when active work does not drain', async () => {
    const tracker = new ActiveConnectionTracker()
    tracker.beginHttp('api-a')
    expect(await tracker.waitForIdle(5)).toBe(false)
  })
})
