import { describe, expect, it } from 'vitest'
import { MemoryStore } from './memoryStore'
import { config, member, post, storeContract } from './storeContract'

describe('MemoryStore', () => {
  storeContract(() => new MemoryStore())

  it('seeds from init without aliasing the inputs', () => {
    const m = member('m1')
    const s = new MemoryStore({ config, members: [m], posts: [post('p1')] })
    m.name = 'mutated after'
    expect(s.getConfig()).toEqual(config)
    expect(s.members()[0].name).toBe('Name m1')
    expect(s.posts()).toHaveLength(1)
  })

  it('does not alias records passed to put*', () => {
    const s = new MemoryStore()
    const m = member('m1')
    s.putMember(m)
    m.name = 'mutated after'
    expect(s.members()[0].name).toBe('Name m1')
  })

  it('getConfig returns a copy', () => {
    const s = new MemoryStore({ config })
    s.getConfig().apiKey = 'mutated'
    expect(s.getConfig().apiKey).toBe('key')
  })
})
