import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'

export const Route = createFileRoute('/')({
  component: BillSplitterApp,
})

type HomeItem = { id: string; name: string }
type MemberItem = { id: string; name: string; seq: number }
type ShareItem = {
  id: string
  memberId: string
  memberName?: string
  amountCents: number
  paidAt: string | null
}
type BillItem = {
  id: string
  homeId: string
  title: string
  totalCents: number
  shares: ShareItem[]
}
type BalanceItem = { memberId: string; name: string; outstandingCents: number }

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)} (${cents}¢)`
}

function BillSplitterApp() {
  const [homes, setHomes] = useState<HomeItem[]>([])
  const [selectedHomeId, setSelectedHomeId] = useState<string>('')
  const [members, setMembers] = useState<MemberItem[]>([])
  const [bills, setBills] = useState<BillItem[]>([])
  const [balances, setBalances] = useState<BalanceItem[]>([])

  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [payingShareId, setPayingShareId] = useState<string | null>(null)

  // Inputs
  const [newHomeName, setNewHomeName] = useState('')
  const [newMemberName, setNewMemberName] = useState('')
  const [newBillTitle, setNewBillTitle] = useState('')
  const [newBillAmount, setNewBillAmount] = useState('')

  // 1. Fetch all homes
  const fetchHomes = useCallback(async () => {
    try {
      setIsLoading(true)
      setErrorMsg(null)
      const res = await fetch('/api/homes')
      if (!res.ok) throw new Error(`Failed to load homes (${res.status})`)
      const data = (await res.json()) as { homes: HomeItem[] }
      setHomes(data.homes ?? [])
      if (data.homes && data.homes.length > 0) {
        setSelectedHomeId((prev) => prev || data.homes[0]?.id || '')
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Unknown network error')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchHomes()
  }, [fetchHomes])

  // 2. Fetch selected home details (members, bills, balances)
  const loadHomeDetails = useCallback(async (homeId: string) => {
    if (!homeId) return
    try {
      setIsLoading(true)
      setErrorMsg(null)

      const [homeRes, billsRes, balancesRes] = await Promise.all([
        fetch(`/api/homes/${homeId}`),
        fetch(`/api/homes/${homeId}/bills`),
        fetch(`/api/homes/${homeId}/balances`),
      ])

      if (homeRes.ok) {
        const homeData = (await homeRes.json()) as { members: MemberItem[] }
        setMembers(homeData.members ?? [])
      }

      if (billsRes.ok) {
        const billsData = (await billsRes.json()) as { bills: BillItem[] }
        setBills(billsData.bills ?? [])
      }

      if (balancesRes.ok) {
        const balancesData = (await balancesRes.json()) as {
          balances: BalanceItem[]
        }
        setBalances(balancesData.balances ?? [])
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Error fetching home data')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (selectedHomeId) {
      loadHomeDetails(selectedHomeId)
    }
  }, [selectedHomeId, loadHomeDetails])

  // Handlers
  const handleCreateHome = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newHomeName.trim()) return
    try {
      setErrorMsg(null)
      const res = await fetch('/api/homes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newHomeName.trim() }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Creation failed' }))
        throw new Error(err.error || 'Failed to create home')
      }
      const created = (await res.json()) as HomeItem
      setNewHomeName('')
      setHomes((prev) => [created, ...prev])
      setSelectedHomeId(created.id)
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Error creating home')
    }
  }

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedHomeId || !newMemberName.trim()) return
    try {
      setErrorMsg(null)
      const res = await fetch(`/api/homes/${selectedHomeId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newMemberName.trim() }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Member addition failed' }))
        throw new Error(err.error || 'Failed to add member')
      }
      setNewMemberName('')
      await loadHomeDetails(selectedHomeId)
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Error adding member')
    }
  }

  const handleCreateBill = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedHomeId || !newBillTitle.trim() || !newBillAmount) return
    const cents = Number.parseInt(newBillAmount, 10)
    if (Number.isNaN(cents) || cents <= 0) {
      setErrorMsg('Total amount must be a positive whole number of cents')
      return
    }

    try {
      setErrorMsg(null)
      const res = await fetch(`/api/homes/${selectedHomeId}/bills`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newBillTitle.trim(),
          totalCents: cents,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Bill creation failed' }))
        throw new Error(err.error || 'Failed to create bill')
      }
      setNewBillTitle('')
      setNewBillAmount('')
      await loadHomeDetails(selectedHomeId)
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Error creating bill')
    }
  }

  const handlePayShare = async (billId: string, shareId: string) => {
    try {
      setPayingShareId(shareId)
      setErrorMsg(null)
      const idempotencyKey = crypto.randomUUID()
      const res = await fetch(`/api/bills/${billId}/shares/${shareId}/pay`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Payment processing failed' }))
        throw new Error(err.error || `Payment failed (${res.status})`)
      }

      await loadHomeDetails(selectedHomeId)
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Payment error occurred')
    } finally {
      setPayingShareId(null)
    }
  }

  return (
    <main
      style={{
        padding: '32px 24px',
        maxWidth: 960,
        margin: '0 auto',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        color: '#0f172a',
      }}
    >
      <header
        style={{
          borderBottom: '2px solid #e2e8f0',
          paddingBottom: 16,
          marginBottom: 24,
        }}
      >
        <h1
          style={{
            fontSize: '1.8rem',
            fontWeight: 700,
            color: '#1e293b',
            margin: 0,
          }}
        >
          Shared Bill Splitter
        </h1>
        <p style={{ color: '#64748b', margin: '4px 0 0 0', fontSize: '0.95rem' }}>
          Stealth PropTech Platform &bull; Cloudflare Workers &amp; D1 &bull; Single-Stack
          TypeScript
        </p>
      </header>

      {errorMsg && (
        <div
          role="alert"
          style={{
            background: '#fef2f2',
            border: '1px solid #f87171',
            color: '#b91c1c',
            padding: '12px 16px',
            borderRadius: 6,
            marginBottom: 20,
            fontSize: '0.9rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>
            <strong>Error:</strong> {errorMsg}
          </span>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#b91c1c',
              cursor: 'pointer',
              fontWeight: 'bold',
            }}
          >
            &times;
          </button>
        </div>
      )}

      {/* Top Controls: Home Selection and Creation */}
      <section
        style={{
          background: '#f8fafc',
          padding: 20,
          borderRadius: 8,
          border: '1px solid #e2e8f0',
          marginBottom: 24,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 20,
        }}
      >
        <div>
          <label
            htmlFor="home-select"
            style={{
              display: 'block',
              fontWeight: 600,
              fontSize: '0.88rem',
              marginBottom: 6,
            }}
          >
            Select Home:
          </label>
          <select
            id="home-select"
            value={selectedHomeId}
            onChange={(e) => setSelectedHomeId(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px',
              borderRadius: 6,
              border: '1px solid #cbd5e1',
              fontSize: '0.9rem',
              background: '#fff',
            }}
          >
            {homes.length === 0 && <option value="">No homes created yet</option>}
            {homes.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </div>

        <form onSubmit={handleCreateHome}>
          <label
            htmlFor="new-home-name"
            style={{
              display: 'block',
              fontWeight: 600,
              fontSize: '0.88rem',
              marginBottom: 6,
            }}
          >
            Create New Home:
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              id="new-home-name"
              type="text"
              placeholder="e.g. Flat 4B, Greenwood"
              value={newHomeName}
              onChange={(e) => setNewHomeName(e.target.value)}
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: 6,
                border: '1px solid #cbd5e1',
                fontSize: '0.9rem',
              }}
            />
            <button
              type="submit"
              style={{
                padding: '8px 16px',
                background: '#2563eb',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Add Home
            </button>
          </div>
        </form>
      </section>

      {/* Main Workspace for Selected Home */}
      {selectedHomeId ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 24 }}>
          {/* Left Column: Bills & Shares */}
          <div>
            <div
              style={{
                background: '#fff',
                border: '1px solid #e2e8f0',
                borderRadius: 8,
                padding: 20,
                marginBottom: 24,
              }}
            >
              <h2
                style={{
                  fontSize: '1.15rem',
                  fontWeight: 600,
                  margin: '0 0 16px 0',
                }}
              >
                Split a New Bill
              </h2>
              <form onSubmit={handleCreateBill} style={{ display: 'grid', gap: 12 }}>
                <div>
                  <label
                    htmlFor="bill-title"
                    style={{
                      display: 'block',
                      fontSize: '0.82rem',
                      fontWeight: 600,
                      marginBottom: 4,
                    }}
                  >
                    Bill Title
                  </label>
                  <input
                    id="bill-title"
                    type="text"
                    placeholder="e.g. Wi-Fi, Electricity, Cleaning"
                    value={newBillTitle}
                    onChange={(e) => setNewBillTitle(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: 6,
                      border: '1px solid #cbd5e1',
                      fontSize: '0.9rem',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
                <div>
                  <label
                    htmlFor="bill-cents"
                    style={{
                      display: 'block',
                      fontSize: '0.82rem',
                      fontWeight: 600,
                      marginBottom: 4,
                    }}
                  >
                    Total Amount (Whole Cents, e.g. 3000 = $30.00)
                  </label>
                  <input
                    id="bill-cents"
                    type="number"
                    min="1"
                    step="1"
                    placeholder="e.g. 3000"
                    value={newBillAmount}
                    onChange={(e) => setNewBillAmount(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: 6,
                      border: '1px solid #cbd5e1',
                      fontSize: '0.9rem',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
                <button
                  type="submit"
                  disabled={members.length === 0}
                  style={{
                    padding: '10px 16px',
                    background: members.length > 0 ? '#0f766e' : '#94a3b8',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 6,
                    fontWeight: 600,
                    cursor: members.length > 0 ? 'pointer' : 'not-allowed',
                    marginTop: 4,
                  }}
                >
                  {members.length === 0 ? 'Add Members First to Split Bills' : 'Split Bill'}
                </button>
              </form>
            </div>

            {/* List of Bills */}
            <div>
              <h2
                style={{
                  fontSize: '1.2rem',
                  fontWeight: 600,
                  margin: '0 0 12px 0',
                }}
              >
                Home Bills ({bills.length})
              </h2>

              {isLoading && bills.length === 0 ? (
                <div
                  style={{
                    padding: 32,
                    textAlign: 'center',
                    color: '#64748b',
                    background: '#f8fafc',
                    borderRadius: 8,
                  }}
                >
                  Loading bills and shares...
                </div>
              ) : bills.length === 0 ? (
                <div
                  style={{
                    padding: 32,
                    textAlign: 'center',
                    color: '#64748b',
                    background: '#f8fafc',
                    borderRadius: 8,
                    border: '1px dashed #cbd5e1',
                  }}
                >
                  No bills split yet for this home. Add a bill above to split it.
                </div>
              ) : (
                <div style={{ display: 'grid', gap: 16 }}>
                  {bills.map((bill) => (
                    <div
                      key={bill.id}
                      style={{
                        background: '#fff',
                        border: '1px solid #e2e8f0',
                        borderRadius: 8,
                        padding: 16,
                        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'baseline',
                          borderBottom: '1px solid #f1f5f9',
                          paddingBottom: 8,
                          marginBottom: 12,
                        }}
                      >
                        <span style={{ fontWeight: 700, fontSize: '1.05rem' }}>{bill.title}</span>
                        <span
                          style={{
                            fontWeight: 700,
                            color: '#0f766e',
                            fontSize: '0.95rem',
                          }}
                        >
                          {formatCents(bill.totalCents)}
                        </span>
                      </div>

                      <div style={{ display: 'grid', gap: 8 }}>
                        {bill.shares.map((share) => {
                          const isPaid = share.paidAt !== null
                          const isPaying = payingShareId === share.id
                          return (
                            <div
                              key={share.id}
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                padding: '8px 12px',
                                background: isPaid ? '#f0fdf4' : '#fffbeb',
                                border: `1px solid ${isPaid ? '#bbf7d0' : '#fef08a'}`,
                                borderRadius: 6,
                                fontSize: '0.88rem',
                              }}
                            >
                              <div>
                                <span style={{ fontWeight: 600 }}>
                                  {share.memberName || 'Member'}
                                </span>
                                <span style={{ color: '#64748b', marginLeft: 8 }}>
                                  {formatCents(share.amountCents)}
                                </span>
                              </div>
                              <div>
                                {isPaid ? (
                                  <span
                                    style={{
                                      color: '#15803d',
                                      fontWeight: 600,
                                      fontSize: '0.8rem',
                                    }}
                                  >
                                    Paid &bull;{' '}
                                    {new Date(share.paidAt || '').toLocaleTimeString([], {
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })}
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => handlePayShare(bill.id, share.id)}
                                    disabled={isPaying}
                                    style={{
                                      padding: '4px 12px',
                                      background: isPaying ? '#94a3b8' : '#d97706',
                                      color: '#fff',
                                      border: 'none',
                                      borderRadius: 4,
                                      fontSize: '0.82rem',
                                      fontWeight: 600,
                                      cursor: isPaying ? 'wait' : 'pointer',
                                    }}
                                  >
                                    {isPaying ? 'Paying...' : 'Pay Share'}
                                  </button>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Members & Balances */}
          <div>
            {/* Add Member Card */}
            <div
              style={{
                background: '#fff',
                border: '1px solid #e2e8f0',
                borderRadius: 8,
                padding: 16,
                marginBottom: 20,
              }}
            >
              <h3
                style={{
                  fontSize: '1rem',
                  fontWeight: 600,
                  margin: '0 0 12px 0',
                }}
              >
                Add Member
              </h3>
              <form onSubmit={handleAddMember} style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  placeholder="e.g. Asha, Ben"
                  value={newMemberName}
                  onChange={(e) => setNewMemberName(e.target.value)}
                  style={{
                    flex: 1,
                    padding: '8px 10px',
                    borderRadius: 6,
                    border: '1px solid #cbd5e1',
                    fontSize: '0.88rem',
                  }}
                />
                <button
                  type="submit"
                  style={{
                    padding: '8px 14px',
                    background: '#334155',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 6,
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontSize: '0.88rem',
                  }}
                >
                  Add
                </button>
              </form>
            </div>

            {/* Balances Summary Card */}
            <div
              style={{
                background: '#fff',
                border: '1px solid #e2e8f0',
                borderRadius: 8,
                padding: 16,
              }}
            >
              <h3
                style={{
                  fontSize: '1rem',
                  fontWeight: 600,
                  margin: '0 0 12px 0',
                }}
              >
                Outstanding Balances
              </h3>
              {balances.length === 0 ? (
                <p style={{ color: '#64748b', fontSize: '0.88rem', margin: 0 }}>
                  No members added yet.
                </p>
              ) : (
                <div style={{ display: 'grid', gap: 8 }}>
                  {balances.map((b) => (
                    <div
                      key={b.memberId}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        padding: '6px 0',
                        borderBottom: '1px solid #f8fafc',
                        fontSize: '0.88rem',
                      }}
                    >
                      <span style={{ fontWeight: 500 }}>{b.name}</span>
                      <span
                        style={{
                          fontWeight: 700,
                          color: b.outstandingCents > 0 ? '#dc2626' : '#16a34a',
                        }}
                      >
                        {formatCents(b.outstandingCents)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div
          style={{
            padding: 48,
            textAlign: 'center',
            background: '#f8fafc',
            borderRadius: 8,
            border: '1px dashed #cbd5e1',
            color: '#64748b',
          }}
        >
          Create or select a home above to start splitting bills.
        </div>
      )}
    </main>
  )
}
