import { Hono } from 'hono'

type Bindings = {
  DB: D1Database
}

const app = new Hono<{ Bindings: Bindings }>()

app.get('/api/health', (c) => c.json({ status: 'ok' }))

// Query: GET /api/homes
app.get('/api/homes', async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT id, name, created_at FROM homes ORDER BY created_at DESC',
  ).all<{ id: string; name: string; created_at: number }>()
  return c.json({ homes: rows.results ?? [] })
})

// Query: GET /api/homes/:homeId
app.get('/api/homes/:homeId', async (c) => {
  const homeId = c.req.param('homeId')
  const home = await c.env.DB.prepare('SELECT id, name FROM homes WHERE id = ?')
    .bind(homeId)
    .first<{ id: string; name: string }>()

  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const members = await c.env.DB.prepare(
    'SELECT id, home_id as homeId, name, seq FROM members WHERE home_id = ? ORDER BY seq ASC, created_at ASC',
  )
    .bind(homeId)
    .all<{ id: string; homeId: string; name: string; seq: number }>()

  return c.json({
    id: home.id,
    name: home.name,
    members: members.results ?? [],
  })
})

// Query: GET /api/homes/:homeId/bills
app.get('/api/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')
  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<{ id: string }>()

  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const bills = await c.env.DB.prepare(
    'SELECT id, home_id as homeId, title, total_cents as totalCents, created_at FROM bills WHERE home_id = ? ORDER BY created_at DESC',
  )
    .bind(homeId)
    .all<{
      id: string
      homeId: string
      title: string
      totalCents: number
      created_at: number
    }>()

  const shares = await c.env.DB.prepare(
    `SELECT 
      s.id, 
      s.bill_id as billId, 
      s.member_id as memberId, 
      m.name as memberName, 
      s.amount_cents as amountCents, 
      s.paid_at as paidAt
    FROM shares s
    JOIN bills b ON b.id = s.bill_id
    JOIN members m ON m.id = s.member_id
    WHERE b.home_id = ?
    ORDER BY m.seq ASC, m.created_at ASC`,
  )
    .bind(homeId)
    .all<{
      id: string
      billId: string
      memberId: string
      memberName: string
      amountCents: number
      paidAt: string | null
    }>()

  const allBills = bills.results ?? []
  const allShares = shares.results ?? []

  const billsWithShares = allBills.map((bill) => ({
    id: bill.id,
    homeId: bill.homeId,
    title: bill.title,
    totalCents: bill.totalCents,
    shares: allShares.filter((s) => s.billId === bill.id),
  }))

  return c.json({ bills: billsWithShares })
})

// 1. POST /api/homes
app.post('/api/homes', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body || typeof body.name !== 'string' || !body.name.trim()) {
    return c.json({ error: 'Home name is required' }, 400)
  }

  const id = crypto.randomUUID()
  const name = body.name.trim()
  const now = Date.now()

  await c.env.DB.prepare('INSERT INTO homes (id, name, created_at) VALUES (?, ?, ?)')
    .bind(id, name, now)
    .run()

  return c.json({ id, name }, 201)
})

// 2. POST /api/homes/:homeId/members
app.post('/api/homes/:homeId/members', async (c) => {
  const homeId = c.req.param('homeId')
  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<{ id: string }>()

  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const body = await c.req.json().catch(() => null)
  if (!body || typeof body.name !== 'string' || !body.name.trim()) {
    return c.json({ error: 'Member name is required' }, 400)
  }

  const countRow = await c.env.DB.prepare('SELECT COUNT(*) as count FROM members WHERE home_id = ?')
    .bind(homeId)
    .first<{ count: number }>()

  const seq = (countRow?.count ?? 0) + 1
  const id = crypto.randomUUID()
  const name = body.name.trim()
  const now = Date.now()

  await c.env.DB.prepare(
    'INSERT INTO members (id, home_id, name, seq, created_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(id, homeId, name, seq, now)
    .run()

  return c.json({ id, homeId, name }, 201)
})

// 3. POST /api/homes/:homeId/bills
app.post('/api/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')
  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<{ id: string }>()

  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const body = await c.req.json().catch(() => null)
  if (!body || typeof body.title !== 'string') {
    return c.json({ error: 'Bill title is required' }, 422)
  }

  const totalCents = body.totalCents
  if (typeof totalCents !== 'number' || !Number.isInteger(totalCents) || totalCents <= 0) {
    return c.json({ error: 'totalCents must be a positive integer' }, 422)
  }

  const membersResult = await c.env.DB.prepare(
    'SELECT id, name FROM members WHERE home_id = ? ORDER BY seq ASC, created_at ASC',
  )
    .bind(homeId)
    .all<{ id: string; name: string }>()

  const members = membersResult.results ?? []
  if (members.length === 0) {
    return c.json({ error: 'Home has no members' }, 422)
  }

  const billId = crypto.randomUUID()
  const title = body.title.trim()
  const now = Date.now()

  const memberCount = members.length
  const baseShare = Math.floor(totalCents / memberCount)
  const remainder = totalCents % memberCount

  const shares: Array<{
    id: string
    memberId: string
    amountCents: number
    paidAt: string | null
  }> = []

  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(
      'INSERT INTO bills (id, home_id, title, total_cents, created_at) VALUES (?, ?, ?, ?, ?)',
    ).bind(billId, homeId, title, totalCents, now),
  ]

  for (let i = 0; i < memberCount; i++) {
    const member = members[i]
    if (!member) continue
    const shareId = crypto.randomUUID()
    const amountCents = baseShare + (i < remainder ? 1 : 0)

    shares.push({
      id: shareId,
      memberId: member.id,
      amountCents,
      paidAt: null,
    })

    statements.push(
      c.env.DB.prepare(
        'INSERT INTO shares (id, bill_id, member_id, amount_cents, paid_at, idempotency_key) VALUES (?, ?, ?, ?, NULL, NULL)',
      ).bind(shareId, billId, member.id, amountCents),
    )
  }

  await c.env.DB.batch(statements)

  return c.json(
    {
      id: billId,
      homeId,
      title,
      totalCents,
      shares,
    },
    201,
  )
})

// 4. POST /api/bills/:billId/shares/:shareId/pay
app.post('/api/bills/:billId/shares/:shareId/pay', async (c) => {
  const idempotencyKey = c.req.header('Idempotency-Key')
  if (!idempotencyKey?.trim()) {
    return c.json({ error: 'Idempotency-Key header is required' }, 400)
  }

  const billId = c.req.param('billId')
  const shareId = c.req.param('shareId')

  const bill = await c.env.DB.prepare('SELECT id FROM bills WHERE id = ?')
    .bind(billId)
    .first<{ id: string }>()

  if (!bill) {
    return c.json({ error: 'Bill not found' }, 404)
  }

  const share = await c.env.DB.prepare(
    'SELECT id, bill_id, member_id, amount_cents, paid_at, idempotency_key FROM shares WHERE id = ? AND bill_id = ?',
  )
    .bind(shareId, billId)
    .first<{
      id: string
      bill_id: string
      member_id: string
      amount_cents: number
      paid_at: string | null
      idempotency_key: string | null
    }>()

  if (!share) {
    return c.json({ error: 'Share not found' }, 404)
  }

  if (share.paid_at !== null) {
    if (share.idempotency_key === idempotencyKey.trim()) {
      return c.json({
        id: share.id,
        memberId: share.member_id,
        amountCents: share.amount_cents,
        paidAt: share.paid_at,
      })
    }
    return c.json({ error: 'Share already paid with a different idempotency key' }, 409)
  }

  const nowIso = new Date().toISOString()
  const result = await c.env.DB.prepare(
    'UPDATE shares SET paid_at = ?, idempotency_key = ? WHERE id = ? AND paid_at IS NULL',
  )
    .bind(nowIso, idempotencyKey.trim(), shareId)
    .run()

  if (result.meta.changes === 0) {
    const recheck = await c.env.DB.prepare(
      'SELECT id, member_id, amount_cents, paid_at, idempotency_key FROM shares WHERE id = ?',
    )
      .bind(shareId)
      .first<{
        id: string
        member_id: string
        amount_cents: number
        paid_at: string | null
        idempotency_key: string | null
      }>()

    if (recheck?.idempotency_key === idempotencyKey.trim()) {
      return c.json({
        id: recheck.id,
        memberId: recheck.member_id,
        amountCents: recheck.amount_cents,
        paidAt: recheck.paid_at,
      })
    }
    return c.json({ error: 'Share already paid with a different idempotency key' }, 409)
  }

  return c.json({
    id: share.id,
    memberId: share.member_id,
    amountCents: share.amount_cents,
    paidAt: nowIso,
  })
})

// 5. GET /api/homes/:homeId/balances
app.get('/api/homes/:homeId/balances', async (c) => {
  const homeId = c.req.param('homeId')
  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<{ id: string }>()

  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const rows = await c.env.DB.prepare(
    `SELECT 
      m.id as memberId,
      m.name,
      COALESCE(SUM(CASE WHEN s.paid_at IS NULL AND s.id IS NOT NULL THEN s.amount_cents ELSE 0 END), 0) as outstandingCents
    FROM members m
    LEFT JOIN bills b ON b.home_id = m.home_id
    LEFT JOIN shares s ON s.bill_id = b.id AND s.member_id = m.id
    WHERE m.home_id = ?
    GROUP BY m.id, m.name, m.seq
    ORDER BY m.seq ASC, m.created_at ASC`,
  )
    .bind(homeId)
    .all<{
      memberId: string
      name: string
      outstandingCents: number
    }>()

  return c.json({
    balances: rows.results ?? [],
  })
})

export default app
