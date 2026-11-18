import { describe, expect, it } from 'vitest'
import { greet } from './main'

describe('greet', () => {
  it('greets by name', () => {
    expect(greet('AIDE')).toBe('Hello, AIDE!')
  })
})
