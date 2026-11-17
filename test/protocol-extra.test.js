import test from 'node:test'
import assert from 'node:assert/strict'
import { INTENTS, INTENT_SPECS, sanitizeTrack, summarizePet } from '../lib/protocol.js'

test('protocol：睡觉/叫醒/动作是合法意图', () => {
  for (const intent of ['sleep', 'wake', 'action']) {
    assert.ok(INTENTS.includes(intent), intent)
    assert.equal(typeof INTENT_SPECS[intent].text, 'string')
  }
})

test('protocol：sanitizeTrack 收窄音乐信息', () => {
  const track = sanitizeTrack({ id: 'nc:123456', name: '  冻结  ', artists: ['林俊杰', '', 'x'.repeat(40)], source: 'nc', extra: 1 })
  assert.equal(track.name, '冻结')
  assert.equal(track.id, 'nc:123456')
  assert.equal(track.source, 'nc')
  assert.equal(track.artists.length, 2)
  assert.equal(track.artists[0], '林俊杰')
  assert.equal('extra' in track, false)

  assert.equal(sanitizeTrack({ name: '   ' }), null)
  assert.equal(sanitizeTrack('nope'), null)
  const odd = sanitizeTrack({ id: '../../etc/passwd', name: '歌', source: 'quote' })
  assert.equal(odd.id, 'etcpasswd')
  assert.equal(odd.source, 'local')

  // 电台没有可映射的曲目 id，只带 http(s) 流地址；其它来源不接受 url 字段。
  const radio = sanitizeTrack({ name: '城市民谣台', source: 'radio', url: 'https://radio.example.com/live.mp3' })
  assert.equal(radio.source, 'radio')
  assert.equal(radio.url, 'https://radio.example.com/live.mp3')
  assert.equal('url' in sanitizeTrack({ name: '歌', source: 'qq', url: 'https://x/y.mp3' }), false)
  assert.equal('url' in sanitizeTrack({ name: '台', source: 'radio', url: 'javascript:alert(1)' }), false)

  // 播放位置要带到对端，否则切歌只能从头放。
  const at = sanitizeTrack({ id: 'nc:1', name: '歌', source: 'nc', position: 92.34 })
  assert.equal(at.position, 92.3)
  assert.equal('position' in sanitizeTrack({ id: 'nc:1', name: '歌', position: 0 }), false)
  assert.equal('position' in sanitizeTrack({ id: 'nc:1', name: '歌', position: 'x' }), false)
})

test('protocol：summarizePet 透出可用动作清单', () => {
  const pet = summarizePet({ id: 'main', name: '小鱼', size: 400, actions: ['吃白饭', '吃白饭', '', 3] })
  assert.deepEqual(pet.actions, ['吃白饭'])
  const none = summarizePet({ id: 'main', name: '小鱼', size: 400 })
  assert.equal(none.actions, undefined)
})
