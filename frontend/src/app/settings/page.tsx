'use client';

import { useEffect, useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { apiFetch } from '@/utils/apiFetch';
import { invalidateCache } from '@/utils/cacheStore';
import { MobileCard, MobileCardRow, MobileCardBadge } from '@/components/ui/MobileCard';

type SettingsTab = 'branch' | 'users' | 'products' | 'suppliers' | 'vehicles' | 'whatsapp';

export default function SettingsPage() {
  const [tab, setTab] = useState<SettingsTab>('branch');

  // ─── Branch settings ──────────────────────────────────────────────
  const [branch, setBranch]   = useState({ name: '', address: '', phone: '' });
  const [branchSaved, setBranchSaved] = useState(false);

  // ─── Users ────────────────────────────────────────────────────────
  const [users, setUsers]     = useState<any[]>([]);
  const [newUser, setNewUser] = useState({ name: '', email: '', password: '', role: 'SALESMAN' });
  const [userMsg, setUserMsg] = useState('');

  // ─── Products ─────────────────────────────────────────────────────
  const [products, setProducts]   = useState<any[]>([]);
  const [newProduct, setNewProduct] = useState({ name: '', urduName: '', category: 'vegetable', defaultUnit: 'KG', minStock: 10 });
  const [prodMsg, setProdMsg]     = useState('');

  // ─── WhatsApp settings ────────────────────────────────────────────
  const [waSettings, setWaSettings] = useState({
    companyLogo: '',
    companyName: 'HALAL VEGG SUPPLIES',
    defaultGreeting: '',
    defaultFooter: '',
    defaultBroadcastTime: '09:00',
    defaultImageTemplate: 'default'
  });
  const [waSaved, setWaSaved] = useState(false);

  useEffect(() => {
    Promise.all([loadUsers(), loadProducts(), loadWaSettings()]);
  }, []);

  const loadUsers = async () => {
    const res = await apiFetch('/api/settings/users');
    if (res.ok) { const d = await res.json(); setUsers(d.data ?? []); }
  };

  const loadProducts = async () => {
    const res = await apiFetch('/api/products');
    if (res.ok) { const d = await res.json(); setProducts(d.data ?? []); }
  };

  const loadWaSettings = async () => {
    const res = await apiFetch('/api/broadcasts/settings');
    if (res.ok) {
      const d = await res.json();
      if (d.data) setWaSettings(d.data);
    }
  };

  const saveBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await apiFetch('/api/settings/branch', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(branch) });
    if (res.ok) { setBranchSaved(true); setTimeout(() => setBranchSaved(false), 2000); }
  };

  const saveWaSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await apiFetch('/api/broadcasts/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(waSettings)
    });
    if (res.ok) { setWaSaved(true); setTimeout(() => setWaSaved(false), 2000); }
  };

  const addUser = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await apiFetch('/api/settings/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newUser) });
    const d = await res.json();
    if (res.ok) { setUserMsg('✅ User added'); setNewUser({ name: '', email: '', password: '', role: 'SALESMAN' }); loadUsers(); }
    else         setUserMsg('❌ ' + (d.error ?? 'Failed'));
    setTimeout(() => setUserMsg(''), 3000);
  };

  const addProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await apiFetch('/api/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newProduct) });
    const d = await res.json();
    if (res.ok) {
      invalidateCache();
      window.dispatchEvent(new Event('app-revalidate'));
      setProdMsg('✅ Product added');
      setNewProduct({ name: '', urduName: '', category: 'vegetable', defaultUnit: 'KG', minStock: 10 });
      loadProducts();
    }
    else         setProdMsg('❌ ' + (d.error ?? 'Failed'));
    setTimeout(() => setProdMsg(''), 3000);
  };

  const ROLES = ['OWNER', 'MANAGER', 'CASHIER', 'SALESMAN', 'ACCOUNTANT', 'DELIVERY'];

  return (
    <DashboardLayout>
      {/* Tabs */}
      <div className="va-tabs-inline">
        {(['branch', 'users', 'products', 'suppliers', 'vehicles', 'whatsapp'] as SettingsTab[]).map(t => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t === 'whatsapp' ? 'WhatsApp Broadcast' : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* ─── Branch Tab ──────────────────────────────────────────── */}
      {tab === 'branch' && (
        <div className="va-panel">
          <div className="va-panel-head"><h3>Branch Settings</h3></div>
          <form onSubmit={saveBranch}>
            <div className="va-form-row">
              <div className="va-field"><label>Business Name</label>
                <input value={branch.name} onChange={e => setBranch(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Al-Kareem Vegetables" />
              </div>
              <div className="va-field"><label>Phone</label>
                <input value={branch.phone} onChange={e => setBranch(p => ({ ...p, phone: e.target.value }))} placeholder="0300-0000000" />
              </div>
            </div>
            <div className="va-form-row">
              <div className="va-field" style={{ gridColumn: '1 / -1' }}><label>Address</label>
                <input value={branch.address} onChange={e => setBranch(p => ({ ...p, address: e.target.value }))} placeholder="Distribution center address" />
              </div>
            </div>
            <button type="submit" className="va-btn">{branchSaved ? '✓ Saved!' : 'Save Branch Settings'}</button>
          </form>
        </div>
      )}

      {/* ─── Users Tab ───────────────────────────────────────────── */}
      {tab === 'users' && (
        <>
          <div className="va-panel">
            <div className="va-panel-head"><h3>Add User</h3></div>
            {userMsg && <div style={{ marginBottom: 12, fontSize: 13, fontWeight: 600, color: userMsg.startsWith('✅') ? 'var(--ok)' : 'var(--danger)' }}>{userMsg}</div>}
            <form onSubmit={addUser}>
              <div className="va-form-row">
                <div className="va-field"><label>Full Name</label><input value={newUser.name} onChange={e => setNewUser(p => ({ ...p, name: e.target.value }))} required /></div>
                <div className="va-field"><label>Email</label><input type="email" value={newUser.email} onChange={e => setNewUser(p => ({ ...p, email: e.target.value }))} required /></div>
                <div className="va-field"><label>Password</label><input type="password" value={newUser.password} onChange={e => setNewUser(p => ({ ...p, password: e.target.value }))} required minLength={6} /></div>
                <div className="va-field"><label>Role</label>
                  <select value={newUser.role} onChange={e => setNewUser(p => ({ ...p, role: e.target.value }))}>
                    {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              </div>
              <button type="submit" className="va-btn">Add User</button>
            </form>
          </div>

          <div className="va-panel">
            <div className="va-panel-head"><h3>All Users</h3></div>
            
            {/* Desktop Table View */}
            <div className="hide-mobile" style={{ overflowX: 'auto' }}>
              <table className="va-table">
                <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Active</th></tr></thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id}>
                      <td style={{ fontWeight: 600 }}>{u.name}</td>
                      <td style={{ color: 'var(--muted)' }}>{u.email}</td>
                      <td><span className="va-badge paid">{u.role}</span></td>
                      <td>{u.isActive ? '✅' : '❌'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Card List View */}
            <div className="show-mobile" style={{ display: 'none', flexDirection: 'column', gap: '10px', marginTop: '8px' }}>
              {users.map(u => (
                <MobileCard
                  key={u.id}
                  title={u.name}
                  headerBadge={
                    <MobileCardBadge variant="green">
                      {u.role}
                    </MobileCardBadge>
                  }
                >
                  <MobileCardRow 
                    label="Email" 
                    value={<span style={{ wordBreak: 'break-all' }}>{u.email}</span>} 
                  />
                  <MobileCardRow 
                    label="Account Status" 
                    value={u.isActive ? '✅ Active' : '❌ Inactive'} 
                  />
                </MobileCard>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ─── Products Tab ────────────────────────────────────────── */}
      {tab === 'products' && (
        <>
          <div className="va-panel">
            <div className="va-panel-head"><h3>Add Product</h3></div>
            {prodMsg && <div style={{ marginBottom: 12, fontSize: 13, fontWeight: 600, color: prodMsg.startsWith('✅') ? 'var(--ok)' : 'var(--danger)' }}>{prodMsg}</div>}
            <form onSubmit={addProduct}>
              <div className="va-form-row">
                <div className="va-field"><label>Name (English)</label><input value={newProduct.name} onChange={e => setNewProduct(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Tomato" required /></div>
                <div className="va-field"><label>Name (Urdu)</label><input value={newProduct.urduName} onChange={e => setNewProduct(p => ({ ...p, urduName: e.target.value }))} placeholder="ٹماٹر" style={{ fontFamily: "'Jameel Khushkhat L', 'Noto Nastaliq Urdu'", direction: 'rtl' }} /></div>
                <div className="va-field"><label>Category</label>
                  <select value={newProduct.category} onChange={e => setNewProduct(p => ({ ...p, category: e.target.value }))}>
                    <option value="vegetable">Vegetable</option>
                    <option value="fruit">Fruit</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div className="va-field"><label>Default Unit</label>
                  <select value={newProduct.defaultUnit} onChange={e => setNewProduct(p => ({ ...p, defaultUnit: e.target.value }))}>
                    {['KG','G','DOZEN','PIECE','BOX','CRATE'].map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div className="va-field"><label>Min Stock Alert</label><input type="number" value={newProduct.minStock} onChange={e => setNewProduct(p => ({ ...p, minStock: +e.target.value }))} /></div>
              </div>
              <button type="submit" className="va-btn">Add Product</button>
            </form>
          </div>

          <div className="va-panel">
            <div className="va-panel-head">
              <h3>Product Master</h3>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{products.length} products</span>
            </div>
            
            {/* Desktop Table View */}
            <div className="hide-mobile" style={{ overflowX: 'auto' }}>
              <table className="va-table">
                <thead><tr><th>Name</th><th>Urdu</th><th>Category</th><th>Unit</th><th>Min Stock</th></tr></thead>
                <tbody>
                  {products.map(p => (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 600 }}>{p.name}</td>
                      <td style={{ fontFamily: "'Jameel Khushkhat L', 'Noto Nastaliq Urdu'", direction: 'rtl', fontSize: 15 }}>{p.urduName || '—'}</td>
                      <td style={{ color: 'var(--muted)' }}>{p.category}</td>
                      <td style={{ color: 'var(--muted)' }}>{p.defaultUnit}</td>
                      <td className="mono">{p.minStock}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Card List View */}
            <div className="show-mobile" style={{ display: 'none', flexDirection: 'column', gap: '10px', marginTop: '8px' }}>
              {products.map(p => (
                <MobileCard
                  key={p.id}
                  title={`${p.name} ${p.urduName ? `(${p.urduName})` : ''}`}
                  headerBadge={
                    <MobileCardBadge variant="green">
                      {p.category}
                    </MobileCardBadge>
                  }
                >
                  <MobileCardRow label="Default Unit" value={p.defaultUnit} />
                  <MobileCardRow label="Min Stock Alert" value={p.minStock.toString()} isMono />
                </MobileCard>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ─── Vehicles Tab ─────────────────────────────────────────── */}
      {tab === 'vehicles' && (
        <div className="va-panel">
          <div className="va-panel-head"><h3>Vehicles & Drivers</h3></div>
          <div className="va-empty"><div className="big">Vehicles module</div><div>Add vehicles and drivers from here in Phase 3</div></div>
        </div>
      )}

      {/* ─── Suppliers Tab ────────────────────────────────────────── */}
      {tab === 'suppliers' && (
        <div className="va-panel">
          <div className="va-panel-head"><h3>Supplier Directory</h3></div>
          <div className="va-empty"><div className="big">Manage suppliers</div><div>Full supplier management coming in Phase 2</div></div>
        </div>
      )}

      {/* ─── WhatsApp Broadcast Tab ─────────────────────────────── */}
      {tab === 'whatsapp' && (
        <div className="va-panel">
          <div className="va-panel-head"><h3>WhatsApp Broadcast Settings</h3></div>
          <form onSubmit={saveWaSettings}>
            <div className="va-form-row">
              <div className="va-field"><label>Company Name</label>
                <input value={waSettings.companyName} onChange={e => setWaSettings(p => ({ ...p, companyName: e.target.value }))} placeholder="e.g. HALAL VEGG SUPPLIES" required />
              </div>
              <div className="va-field"><label>Company Logo URL</label>
                <input value={waSettings.companyLogo || ''} onChange={e => setWaSettings(p => ({ ...p, companyLogo: e.target.value }))} placeholder="https://example.com/logo.png" />
              </div>
            </div>
            <div className="va-form-row">
              <div className="va-field"><label>Default Broadcast Time</label>
                <input type="time" value={waSettings.defaultBroadcastTime} onChange={e => setWaSettings(p => ({ ...p, defaultBroadcastTime: e.target.value }))} />
              </div>
              <div className="va-field"><label>Image Template Theme</label>
                <select value={waSettings.defaultImageTemplate} onChange={e => setWaSettings(p => ({ ...p, defaultImageTemplate: e.target.value }))}>
                  <option value="default">Forest Green (Branded sabzi)</option>
                  <option value="light">Minimal Clean Light</option>
                  <option value="dark">Professional Dark Mode</option>
                </select>
              </div>
            </div>
            <div className="va-form-row">
              <div className="va-field" style={{ gridColumn: '1 / -1' }}><label>Default Greeting Message Template</label>
                <textarea 
                  value={waSettings.defaultGreeting} 
                  onChange={e => setWaSettings(p => ({ ...p, defaultGreeting: e.target.value }))}
                  placeholder="Greeting text supporting {{ClientName}} token..."
                  rows={6}
                  style={{ width: '100%', padding: '8px', border: '1px solid var(--line)', borderRadius: 6, background: 'var(--paper)', color: 'var(--ink)' }}
                />
              </div>
            </div>
            <div className="va-form-row">
              <div className="va-field" style={{ gridColumn: '1 / -1' }}><label>Default Message Footer / Signoff</label>
                <input value={waSettings.defaultFooter || ''} onChange={e => setWaSettings(p => ({ ...p, defaultFooter: e.target.value }))} placeholder="e.g. HALAL VEGG SUPPLIES Distribution Team" />
              </div>
            </div>
            <button type="submit" className="va-btn">{waSaved ? '✓ Saved!' : 'Save Broadcast Settings'}</button>
          </form>
        </div>
      )}
    </DashboardLayout>
  );
}
