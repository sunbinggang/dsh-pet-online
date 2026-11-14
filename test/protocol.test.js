import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CODE_LENGTH,
  INTENTS,
  PROTOCOL_VERSION,
  fillTemplate,
  isEnvelope,
  isInteraction,
  newPairingCode,
  normalizeCode,
  roomOf,
  sanitizeText,
  summarizePet,
} from '../lib/protocol.js'

test('配对码：长度 6、只含易读字符、可规范化', () => {
  for (let i = 0; i < 50; i += 1) {
    const code = newPairingCode()
    assert.equal(code.length, CODE_LENGTH)
    assert.match(code, /^[A-Z2-9]{6}$/)
    assert.equal(normalizeCode(code.toLowerCase()), code)
  }
  assert.equal(normalizeCode(' ab c23 '), '') // 去空白后 5 位 -> 非法
  assert.equal(normalizeCode('abc234'), 'ABC234')
  assert.equal(normalizeCode('ABC23O'), '') // O 不在字符表里
  assert.equal(normalizeCode(''), '')
  assert.equal(normalizeCode(null), '')
})

test('房间名 = pair:<码>', () => {
  assert.equal(roomOf('abc234'), 'pair:ABC234')
})

test('sanitizeText 去控制字符并截断', () => {
  assert.equal(sanitizeText('  你好\u0000世界  '), '你好 世界')
  assert.equal(sanitizeText('x'.repeat(100), 10).length, 10)
  assert.equal(sanitizeText(42), '')
})

test('帧形状校验', () => {
  assert.equal(isEnvelope({ type: 'presence' }), true)
  assert.equal(isEnvelope({}), false)
  assert.equal(isEnvelope(null), false)
  assert.equal(isInteraction({ type: 'interaction', payload: { msgId: 'm1', intent: 'wave' } }), true)
  assert.equal(isInteraction({ type: 'interaction', payload: { msgId: 'm1', intent: 'nuke' } }), false)
  assert.equal(isInteraction({ type: 'interaction', payload: { intent: 'wave' } }), false)
  assert.ok(INTENTS.includes('visit-note'))
  assert.equal(PROTOCOL_VERSION, 1)
})

test('宠物摘要：只带联机需要的字段，气泡受开关控制', () => {
  const pet = {
    id: 'main',
    name: '蓝毛小女仆',
    size: 462.7,
    display: 'both',
    anim: '点击回应-开心跃动',
    facing: 'right',
    sleeping: false,
    bubble: '今天也要好好干活哦~',
    bubbleImage: 'Ciallo',
    x: 0.123456,
    y: 0.5,
  }
  const withBubble = summarizePet(pet, { shareBubbles: true })
  assert.equal(withBubble.size, 463)
  assert.equal(withBubble.bubble, '今天也要好好干活哦~')
  assert.equal(withBubble.bubbleImage, 'Ciallo')
  assert.equal(withBubble.x, 0.123)
  const noBubble = summarizePet(pet, { shareBubbles: false })
  assert.equal(noBubble.bubble, undefined)
  assert.equal(summarizePet({ id: 'x', size: Number.NaN }, {}).size, 160)
  // 没有动作名时靠待机动画兜底，投影侧才不会只剩名字
  assert.equal(summarizePet({ id: 'x', idle: '待机呼吸休闲' }, {}).idle, '待机呼吸休闲')
})

test('模板拼接：未知变量留空', () => {
  assert.equal(fillTemplate('{from} 摸了摸你', { from: '小鱼' }), '小鱼 摸了摸你')
  assert.equal(fillTemplate('{from} 留了句话：{note}', { from: 'A' }), 'A 留了句话：')
})
