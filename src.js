import './style.css';
import { createClient } from '@supabase/supabase-js';
import { Chart, registerables } from 'chart.js';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { SIGNATURE_BASE64, LOGO_BASE64 } from './src_assets.js';
import {
  invoiceHeading,
  invoiceWatermark,
  invoiceHistoryActions,
  allocateDraftNumber,
  preservedDraftReference
} from './document_status.js';

Chart.register(...registerables);

// ============================================================================
// IN-MEMORY / LOCALSTORAGE CLIENT (Full fallback for preview/standalone mode)
// ============================================================================
function createMockClient() {
  const defaultStore = {
    company_settings: [{
      id: '00000000-0000-0000-0000-000000000001',
      business_name: 'MS Management Consulting',
      issuer_name: 'MADHU M. S.',
      address: 'SNO.125, 1ST FLOOR, 12TH CROSS 6TH MAIN, 3RD PHASE,\nJ.P.NAGAR, BANGALORE-560078, KARNATAKA',
      state: 'Karnataka',
      state_code: '29',
      gstin: '29APEPM7494M1ZZ',
      pan: 'APEPM7494M',
      email: 'madhumsiddu@gmail.com',
      phone: '9964287173',
      bank_name: 'STATE BANK OF INDIA',
      account_name: 'MADHU M S',
      account_number: '20300723746',
      ifsc: 'SBIN0007117',
      branch: 'JP NAGAR 1ST PHASE, BANGALORE KARNATAKA - 560078',
      default_gst_rate: 18,
      invoice_prefix: '',
      payment_terms: 'Payment due within 15 days of invoice date.',
      invoice_footer: 'This is a computer-generated tax invoice and requires no physical signature.'
    }],
    customers: [{
      id: '11111111-1111-1111-1111-111111111111',
      name: 'DHRUVDESH AUTOMOTIVE PVT LTD',
      billing_address: '#810 , 5TH BLOCK , 100 FEET OUTER RING ROAD\nHOSKEREHALLI , BANASHANKARI 3RD STAGE',
      city: 'BANGALORE',
      state: 'KARNATAKA',
      state_code: '29',
      pin_code: '560085',
      gstin: '29AACCD3464A1ZZ',
      pan: 'AACCD3464A',
      contact_person: 'Accounts Dept',
      phone: '',
      email: '',
      is_active: true
    }],
    invoices: [{
      id: '22222222-2222-2222-2222-222222222222',
      invoice_number: '2026-27/01',
      customer_id: '11111111-1111-1111-1111-111111111111',
      invoice_date: '2026-10-05',
      due_date: '2026-10-20',
      financial_year: '2026-27',
      place_of_supply: 'Karnataka',
      description: 'Professional Services for Management Consultancy for the month of September - 2026',
      hsn_sac: '998312',
      subtotal: 327750,
      discount: 0,
      gst_rate: 18,
      tax_type: 'CGST + SGST',
      tax_amount: 58995,
      cgst: 29497.5,
      sgst: 29497.5,
      igst: 0,
      total: 386745,
      amount_in_words: 'Rupees Three Lakh Eighty Six Thousand Seven Hundred Forty Five Only',
      status: 'unpaid',
      is_draft: false,
      items: [{
        description: 'Professional Services for Management Consultancy\nfor the month of September - 2026',
        hsn_sac: '998312',
        quantity: 1,
        unit_price: 327750,
        discount: 0,
        amount: 327750
      }]
    }],
    invoice_items: [],
    payments: [],
    profiles: [],
    users: [],
    signup_invites: []
  };

  const VAULT_KEY = 'ms_registered_accounts_vault_v1';

  const loadStore = () => {
    let base = null;
    const knownKeys = [
      'ms_consulting_db_clean_v6',
      'ms_consulting_db_v6',
      'ms_consulting_db_v5',
      'ms_consulting_db_v4',
      'ms_consulting_db_v3',
      'ms_consulting_db_v2',
      'ms_consulting_db_v1',
      'ms_billing_mock_db'
    ];

    // 1. Gather existing data from current or previous storage versions without deleting
    for (const k of knownKeys) {
      try {
        const raw = localStorage.getItem(k);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') {
            if (!base) {
              base = parsed;
            } else {
              if (Array.isArray(parsed.users) && parsed.users.length) {
                base.users = [...(base.users || []), ...parsed.users];
              }
              if (Array.isArray(parsed.customers) && parsed.customers.length) {
                base.customers = [...(base.customers || []), ...parsed.customers];
              }
              if (Array.isArray(parsed.invoices) && parsed.invoices.length) {
                base.invoices = [...(base.invoices || []), ...parsed.invoices];
              }
              if (Array.isArray(parsed.payments) && parsed.payments.length) {
                base.payments = [...(base.payments || []), ...parsed.payments];
              }
            }
          }
        }
      } catch {}
    }

    // 2. Scan localStorage for any other user records
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        try {
          const val = localStorage.getItem(k);
          if (val && (val.includes('"password"') || val.includes('"username"') || val.includes('"users"'))) {
            const parsed = JSON.parse(val);
            if (parsed && Array.isArray(parsed.users)) {
              base = base || { ...defaultStore };
              base.users = [...(base.users || []), ...parsed.users];
            } else if (parsed && parsed.email && (parsed.password || parsed.username)) {
              base = base || { ...defaultStore };
              base.users = [...(base.users || []), parsed];
            }
          }
        } catch {}
      }
    } catch {}

    // 3. Scan permanent accounts vault
    try {
      const vaultRaw = localStorage.getItem(VAULT_KEY);
      if (vaultRaw) {
        const vaultUsers = JSON.parse(vaultRaw);
        if (Array.isArray(vaultUsers)) {
          base = base || { ...defaultStore };
          base.users = [...(base.users || []), ...vaultUsers];
        }
      }
    } catch {}

    if (!base) {
      base = JSON.parse(JSON.stringify(defaultStore));
    }

    // Normalize collections
    base.users = Array.isArray(base.users) ? base.users : [];
    base.customers = Array.isArray(base.customers) ? base.customers : [];
    base.invoices = Array.isArray(base.invoices) ? base.invoices : [];
    base.invoice_items = Array.isArray(base.invoice_items) ? base.invoice_items : [];
    base.payments = Array.isArray(base.payments) ? base.payments : [];
    if (!base.company_settings || !base.company_settings.length || !base.company_settings[0].gstin) {
      base.company_settings = defaultStore.company_settings;
    }
    if (!base.customers || !base.customers.length) {
      base.customers = defaultStore.customers;
    }
    if (!base.invoices || !base.invoices.length) {
      base.invoices = defaultStore.invoices;
    }

    // Deduplicate users
    const uniqueUsers = [];
    const seen = new Set();
    for (const u of base.users) {
      if (!u) continue;
      const key = (u.email || u.username || '').toLowerCase();
      if (key && !seen.has(key)) {
        seen.add(key);
        uniqueUsers.push(u);
      }
    }

    base.users = uniqueUsers;

    // Persist to permanent vault so user accounts are never lost again
    try {
      localStorage.setItem(VAULT_KEY, JSON.stringify(base.users));
    } catch {}

    return base;
  };

  const saveStore = (s) => {
    try {
      localStorage.setItem('ms_consulting_db_clean_v6', JSON.stringify(s));
      if (Array.isArray(s.users)) {
        localStorage.setItem(VAULT_KEY, JSON.stringify(s.users));
      }
    } catch {}
  };

  let store = loadStore();
  let authListeners = [];
  let currentUser = null;

  return {
    from(table) {
      if (!store[table]) store[table] = [];
      let filters = [];
      let orderBy = null;
      let limitCount = null;

      const builder = {
        select() { return builder; },
        order(field, opts) {
          orderBy = { field, ascending: opts?.ascending ?? true };
          return builder;
        },
        limit(n) { limitCount = n; return builder; },
        eq(field, val) {
          filters.push(r => String(r[field]) === String(val));
          return builder;
        },
        is(field, val) {
          filters.push(r => r[field] === val);
          return builder;
        },
        gt(field, val) {
          filters.push(r => r[field] > val);
          return builder;
        },
        async single() {
          const res = await builder.then();
          return { data: res.data[0] || null, error: res.data[0] ? null : { message: 'Row not found' } };
        },
        async maybeSingle() {
          const res = await builder.then();
          return { data: res.data[0] || null, error: null };
        },
        then(resolve) {
          let list = [...(store[table] || [])].filter(r => filters.every(f => f(r)));
          if (orderBy) {
            list.sort((a, b) => {
              const va = a[orderBy.field] ?? '', vb = b[orderBy.field] ?? '';
              return orderBy.ascending ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
            });
          }
          if (limitCount !== null) {
            list = list.slice(0, limitCount);
          }
          if (table === 'invoices') {
            list = list.map(inv => ({
              ...inv,
              customers: store.customers?.find(c => c.id === inv.customer_id) || { name: '—' },
              items: store.invoice_items?.filter(item => item.invoice_id === inv.id) || []
            }));
          }
          const res = { data: list, error: null };
          return resolve ? resolve(res) : Promise.resolve(res);
        },
        async insert(payload) {
          const items = Array.isArray(payload) ? payload : [payload];
          const inserted = items.map(item => {
            const row = {
              id: item.id || (table === 'invoices' ? 'inv-' + Date.now() : 'id-' + Math.random().toString(36).slice(2, 9)),
              created_at: new Date().toISOString(),
              ...item
            };
            if (table === 'invoices' && !row.invoice_number) {
              const seq = (store.invoices?.length || 0) + 1;
              const fy = row.financial_year || financialYear();
              const prefix = (store.company_settings?.[0]?.invoice_prefix || '').trim();
              row.invoice_number = prefix ? `${prefix}/${fy}/${String(seq).padStart(2, '0')}` : `${fy}/${String(seq).padStart(2, '0')}`;
              row.status = row.status || (row.is_draft ? 'draft' : 'unpaid');
            }
            if (table === 'payments') {
              const inv = store.invoices?.find(i => i.id === row.invoice_id);
              if (inv) {
                const totalPaid = (store.payments?.filter(p => p.invoice_id === inv.id).reduce((a, b) => a + Number(b.amount), 0) || 0) + Number(row.amount);
                inv.status = totalPaid >= Number(inv.total) ? 'paid' : (totalPaid > 0 ? 'partial' : 'unpaid');
              }
            }
            store[table].push(row);
            return row;
          });
          saveStore(store);
          return { data: Array.isArray(payload) ? inserted : inserted[0], error: null };
        },
        update(payload) {
          return {
            eq(field, val) {
              let updated = null;
              store[table] = store[table].map(r => {
                if (String(r[field]) === String(val)) {
                  updated = { ...r, ...payload, updated_at: new Date().toISOString() };
                  return updated;
                }
                return r;
              });
              saveStore(store);
              const res = { data: updated ? [updated] : [], error: null };
              const p = Promise.resolve(res);
              p.select = () => Promise.resolve(res);
              return p;
            }
          };
        },
        delete() {
          return {
            eq(field, val) {
              // Mirror database policy "invoices_delete_draft_admin_only":
              // only administrators may delete, and only draft invoices.
              if (table === 'invoices') {
                const target = (store.invoices || []).find(r => String(r.id) === String(val));
                if (target) {
                  if (target.is_draft !== true && target.status !== 'cancelled') {
                    return Promise.resolve({ error: { message: 'Only draft or cancelled invoices can be deleted. Finalized active invoices are permanent financial records.' } });
                  }
                  const isAdmin = Boolean(currentUser && ((currentUser.role || currentUser.user_metadata?.role) === 'admin'));
                  if (!isAdmin) {
                    return Promise.resolve({ error: { message: 'Forbidden: Administrator privileges required to delete invoices' } });
                  }
                }
              }
              store[table] = store[table].filter(r => String(r[field]) !== String(val));
              saveStore(store);
              return Promise.resolve({ error: null });
            }
          };
        },
        async upsert(payload) {
          const items = Array.isArray(payload) ? payload : [payload];
          for (const item of items) {
            const idx = store[table].findIndex(r => r.id === item.id);
            if (idx >= 0) {
              store[table][idx] = { ...store[table][idx], ...item, updated_at: new Date().toISOString() };
            } else {
              store[table].push({ id: item.id || 'id-' + Math.random().toString(36).slice(2, 9), ...item });
            }
          }
          saveStore(store);
          return { data: payload, error: null };
        }
      };
      return builder;
    },
    auth: {
      async getUser() { return { data: { user: currentUser } }; },
      async getSession() { return { data: { session: currentUser ? { access_token: 'session-token' } : null } }; },
      async signOut() {
        currentUser = null;
        authListeners.forEach(l => l('SIGNED_OUT', null));
        return { error: null };
      },
      onAuthStateChange(cb) {
        authListeners.push(cb);
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
      getStoredUsers() {
        return (store.users || []).map(u => ({
          id: u.id,
          username: u.username || 'user',
          email: u.email || `${u.username}@msconsulting.in`,
          full_name: u.full_name || u.username || 'User'
        }));
      },
      async signInWithPassword({ email, password }) {
        const input = (email || '').trim().toLowerCase();
        const enteredPass = (password || '').trim();

        if (!input) {
          return {
            data: { user: null },
            error: { message: 'Please enter a valid email address or username.' }
          };
        }

        // 1. Try finding user by exact email, username, or prefix match
        let user = store.users?.find(u =>
          (u.email && u.email.toLowerCase() === input) ||
          (u.username && u.username.toLowerCase() === input) ||
          (u.email && u.email.toLowerCase().split('@')[0] === input) ||
          (input.includes('@') && u.username && input.split('@')[0] === u.username.toLowerCase())
        );

        // 2. User credential validation
        if (user) {
          const expectedPass = user.password;
          if (enteredPass && enteredPass === expectedPass) {
            currentUser = {
              id: user.id || ('usr-' + Date.now()),
              email: user.email,
              user_metadata: { full_name: user.full_name || user.username || 'Administrator', username: user.username, role: user.role || 'staff' }
            };
            authListeners.forEach(l => l('SIGNED_IN', { user: currentUser }));
            return { data: { user: currentUser }, error: null };
          }

          // Incorrect password for this user
          return {
            data: { user: null },
            error: {
              message: 'Invalid email/username or password. Please verify and try again.'
            }
          };
        }

        // 3. User not found
        return {
          data: { user: null },
          error: {
            message: `Account "${input}" not found. Please verify your credentials or register with an invitation code.`
          }
        };
      },
      async signUp() {
        return {
          data: null,
          error: { message: 'Access Denied: Public registration without an invitation is strictly prohibited.' }
        };
      },
      async resetPasswordForEmail() {
        return { data: { message: 'Password recovery email dispatched if account exists.' }, error: null };
      },
      async resetPasswordDirect() {
        return { error: { message: 'Access Denied: Master authentication overrides are permanently removed.' } };
      },
      async updateUser({ password }) {
        if (currentUser && password) {
          const u = store.users?.find(x => x.id === currentUser.id || x.email === currentUser.email);
          if (u) {
            u.password = password.trim();
            saveStore(store);
          }
        }
        return { data: { user: currentUser }, error: null };
      }
    },
    async rpc(funcName, args = {}) {
      if (funcName === 'get_next_invoice_number') {
        const fy = args.p_fy || financialYear();
        const prefix = (store.company_settings?.[0]?.invoice_prefix || '').trim();
        const seq = (store.invoices?.length || 0) + 1;
        const generatedNum = prefix ? `${prefix}/${fy}/${String(seq).padStart(2, '0')}` : `${fy}/${String(seq).padStart(2, '0')}`;
        return { data: generatedNum, error: null };
      }
      if (funcName === 'create_invoice_with_items') {
        let invId = args.p_invoice_id || ('inv-' + Date.now());
        const isEditingDraft = Boolean(args.p_invoice_id);
        const existingInv = isEditingDraft ? store.invoices?.find(i => i.id === invId) : null;
        if (existingInv && !existingInv.is_draft) {
          return { data: null, error: { message: 'Finalized invoice is immutable and cannot be updated.' } };
        }

        const fy = args.p_financial_year || financialYear();
        const prefix = (store.company_settings?.[0]?.invoice_prefix || '').trim();
        const seq = (store.invoices?.length || 0) + 1;
        const isDraft = Boolean(args.p_is_draft);
        const defaultNum = prefix ? `${prefix}/${fy}/${String(seq).padStart(2, '0')}` : `${fy}/${String(seq).padStart(2, '0')}`;
        // Draft numbers follow the professional sequential format
        // DRAFT-<FY>-NNNN, allocated independently of the permanent GST tax
        // invoice sequence. Existing drafts (including historical
        // random-style identifiers) are never renumbered.
        const draftNum = allocateDraftNumber(fy, (store.invoices || []).map(i => i.invoice_number));
        const invNum = existingInv ? existingInv.invoice_number : (isDraft ? draftNum : defaultNum);
        const items = args.p_items || [];
        
        let subtotal = 0;
        if (isEditingDraft) {
          store.invoice_items = (store.invoice_items || []).filter(it => it.invoice_id !== invId);
        }
        const processedItems = items.map((it, idx) => {
          const qty = Number(it.quantity || 1);
          const rate = Number(it.unit_price || 0);
          const disc = Number(it.discount || 0);
          const amt = Math.max(0, (qty * rate) - disc);
          subtotal += amt;
          const itemId = 'item-' + Date.now() + '-' + idx;
          const row = { id: itemId, invoice_id: invId, description: it.description, hsn_sac: it.hsn_sac || '998312', quantity: qty, unit_price: rate, discount: disc, amount: amt };
          store.invoice_items = store.invoice_items || [];
          store.invoice_items.push(row);
          return row;
        });

        const discount = Number(args.p_discount || 0);
        const taxable = Math.max(0, subtotal - discount);
        const rate = Number(args.p_gst_rate ?? 18);
        const taxAmt = Math.round(taxable * rate) / 100;
        const total = taxable + taxAmt;

        const newInv = {
          id: invId,
          invoice_number: invNum,
          customer_id: args.p_customer_id,
          invoice_date: args.p_invoice_date || new Date().toISOString().slice(0, 10),
          due_date: args.p_due_date || new Date(Date.now() + 86400000 * 15).toISOString().slice(0, 10),
          financial_year: fy,
          place_of_supply: args.p_place_of_supply || 'Karnataka (29)',
          description: items[0]?.description || 'Consulting Services',
          hsn_sac: items[0]?.hsn_sac || '998312',
          subtotal,
          discount,
          gst_rate: rate,
          tax_type: 'CGST + SGST',
          cgst: taxAmt / 2,
          sgst: taxAmt / 2,
          igst: 0,
          tax_amount: taxAmt,
          total,
          amount_in_words: amountInWords(total),
          payment_terms: args.p_payment_terms || '',
          notes: args.p_notes || '',
          status: isDraft ? 'draft' : 'unpaid',
          is_draft: isDraft,
          // Preserve the original draft reference in audit history when the
          // SAME invoice record is finalized (never a second record).
          draft_reference: existingInv
            ? (isDraft ? existingInv.draft_reference : (existingInv.invoice_number?.startsWith('DRAFT-') ? existingInv.invoice_number : existingInv.draft_reference))
            : undefined,
          created_by: currentUser?.id,
          created_at: existingInv ? existingInv.created_at : new Date().toISOString(),
          updated_at: new Date().toISOString()
        };

        store.invoices = store.invoices || [];
        if (isEditingDraft) {
          const idx = store.invoices.findIndex(i => i.id === invId);
          if (idx !== -1) store.invoices[idx] = newInv;
          else store.invoices.push(newInv);
        } else {
          store.invoices.push(newInv);
        }
        saveStore(store);
        return { data: { success: true, invoice_id: invId, invoice_number: invNum, total }, error: null };
      }
      if (funcName === 'cancel_invoice') {
        // Mirror database RPC: cancellation is strictly administrator-only.
        const callerIsAdmin = Boolean(currentUser && ((currentUser.role || currentUser.user_metadata?.role) === 'admin'));
        if (!callerIsAdmin) return { data: null, error: { message: 'Forbidden: Administrator privileges required to cancel invoices' } };
        const inv = store.invoices?.find(i => i.id === args.p_invoice_id);
        if (!inv) return { data: null, error: { message: 'Invoice not found' } };
        if (inv.status === 'cancelled') return { data: null, error: { message: 'Invoice is already cancelled' } };
        const activePaid = (store.payments?.filter(p => p.invoice_id === inv.id && !p.is_reversed).reduce((a, b) => a + Number(b.amount), 0) || 0);
        if (activePaid > 0) return { data: null, error: { message: 'Cannot cancel invoice with active payments. Reverse payments first.' } };
        inv.status = 'cancelled';
        inv.notes = (inv.notes ? inv.notes + ' | ' : '') + `Cancelled: ${args.p_reason || 'Admin request'}`;
        saveStore(store);
        return { data: { success: true, invoice_id: inv.id, status: 'cancelled' }, error: null };
      }
      if (funcName === 'record_invoice_payment') {
        const inv = store.invoices?.find(i => i.id === args.p_invoice_id);
        if (!inv) return { data: null, error: { message: 'Invoice not found' } };
        if (inv.status === 'cancelled') return { data: null, error: { message: 'Cannot record payment on cancelled invoice' } };
        const amt = Number(args.p_amount);
        if (amt <= 0) return { data: null, error: { message: 'Payment amount must be greater than zero' } };
        
        const existingPaid = (store.payments?.filter(p => p.invoice_id === inv.id && !p.is_reversed).reduce((a, b) => a + Number(b.amount), 0) || 0);
        if ((existingPaid + amt) > (Number(inv.total) + 0.05)) {
          return { data: null, error: { message: `Payment of ₹${amt} exceeds outstanding balance of ₹${(Number(inv.total) - existingPaid).toFixed(2)}` } };
        }

        const payId = 'pay-' + Date.now();
        const payRow = {
          id: payId,
          invoice_id: inv.id,
          customer_id: inv.customer_id,
          payment_date: args.p_payment_date || new Date().toISOString().slice(0, 10),
          amount: amt,
          method: args.p_method || 'Bank Transfer',
          reference: args.p_reference || '',
          remarks: args.p_remarks || '',
          is_reversed: false,
          created_at: new Date().toISOString()
        };
        store.payments = store.payments || [];
        store.payments.push(payRow);
        const newTotalPaid = existingPaid + amt;
        inv.status = newTotalPaid >= Number(inv.total) ? 'paid' : 'partial';
        saveStore(store);
        return { data: { success: true, payment_id: payId, outstanding: Math.max(0, Number(inv.total) - newTotalPaid) }, error: null };
      }
      if (funcName === 'reverse_invoice_payment') {
        const pay = store.payments?.find(p => p.id === args.p_payment_id);
        if (!pay) return { data: null, error: { message: 'Payment not found' } };
        if (pay.is_reversed) return { data: null, error: { message: 'Payment is already reversed' } };
        pay.is_reversed = true;
        pay.reversed_at = new Date().toISOString();
        pay.reversed_reason = args.p_reason || 'Reversal requested';
        const inv = store.invoices?.find(i => i.id === pay.invoice_id);
        if (inv) {
          const activePaid = (store.payments?.filter(p => p.invoice_id === inv.id && !p.is_reversed).reduce((a, b) => a + Number(b.amount), 0) || 0);
          inv.status = activePaid >= Number(inv.total) ? 'paid' : (activePaid > 0 ? 'partial' : 'unpaid');
        }
        saveStore(store);
        return { data: { success: true, payment_id: pay.id, message: 'Payment reversed' }, error: null };
      }
      return { data: null, error: { message: `Unknown function ${funcName}` } };
    }
  };
}

// Supabase client initialization
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
const isSupabaseLive = Boolean(supabaseUrl && supabaseKey && !supabaseKey.includes('replace_') && supabaseKey.length > 20);

export const sb = isSupabaseLive ? createClient(supabaseUrl, supabaseKey) : createMockClient();

// ============================================================================
// ============================================================================
// APPLICATION STATE
// ============================================================================
const state = {
  user: null,
  role: 'staff',
  fullName: 'User',
  page: 'Dashboard',
  customers: [],
  invoices: [],
  payments: [],
  settings: null,
  editingCustomer: null,
  editingInvoice: null,
  authMode: 'login', // 'login' or 'signup'
  signupSuccessMsg: '',
  activeInviteGenerated: null,
  dashboardFY: '',
  reportsTab: 'monthly',
  activeCharts: {},
  theme: localStorage.getItem('app_theme') || 'light',
  sidebarCollapsed: localStorage.getItem('sidebar_collapsed') === 'true',
  sessionToken: null,
  adminUsersList: null,
  adminInvitesList: null,
  adminMetrics: null,
  adminActivityLogs: [],
  adminLastFetched: 0,
  adminLoading: false,
  profileTab: 'personal', // 'personal', 'theme', 'security', 'activity'
  profileData: {
    phone: localStorage.getItem('profile_phone') || '',
    department: localStorage.getItem('profile_department') || 'Consulting',
    designation: localStorage.getItem('profile_designation') || 'Staff Member',
    location: localStorage.getItem('profile_location') || 'Bangalore',
    bio: localStorage.getItem('profile_bio') || ''
  }
};

// ============================================================================
// THEME MANAGEMENT (Light / Dark & Color Styles)
// ============================================================================
export function applyTheme(themeName) {
  const validThemes = ['light', 'dark', 'colorful-purple', 'colorful-ocean', 'colorful-emerald', 'colorful-sunset'];
  const theme = validThemes.includes(themeName) ? themeName : 'light';
  state.theme = theme;
  try {
    localStorage.setItem('app_theme', theme);
  } catch (e) {}
  document.documentElement.setAttribute('data-theme', theme);
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) {
    const metaColors = {
      'dark': '#0B111E',
      'colorful-purple': '#0D091D',
      'colorful-ocean': '#051424',
      'colorful-emerald': '#051812',
      'colorful-sunset': '#180D08',
      'light': '#F5F7FB'
    };
    metaTheme.setAttribute('content', metaColors[theme] || '#F5F7FB');
  }
}

export function toggleDayNight() {
  const next = state.theme === 'light' ? 'dark' : 'light';
  applyTheme(next);
  return next;
}

// Initial theme application
applyTheme(state.theme);

// ============================================================================
// FORMATTING & MATHEMATICAL UTILITIES
// ============================================================================
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Password Visibility Eye Icons (Open & Closed)
const EYE_OPEN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="eye-icon eye-open"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`;
const EYE_CLOSE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="eye-icon eye-close"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>`;

// Global delegated click handler for password visibility toggles
document.addEventListener('click', e => {
  const btn = e.target.closest('.btn-toggle-pw');
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();

  const wrapper = btn.closest('.password-wrapper');
  if (!wrapper) return;
  const input = wrapper.querySelector('input');
  if (!input) return;

  const isPassword = input.type === 'password';
  input.type = isPassword ? 'text' : 'password';
  btn.innerHTML = isPassword ? EYE_CLOSE_SVG : EYE_OPEN_SVG;
  btn.title = isPassword ? 'Hide password' : 'Show password';
  btn.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
});

// Prevent focus loss when clicking eye icon
document.addEventListener('mousedown', e => {
  if (e.target.closest('.btn-toggle-pw')) {
    e.preventDefault();
  }
});

export function money(n) {
  const num = Number(n || 0);
  return '₹' + num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function financialYear(dateStr) {
  const d = dateStr ? new Date(dateStr) : new Date();
  const y = d.getFullYear() - (d.getMonth() < 3 ? 1 : 0);
  return `${y}-${String(y + 1).slice(-2)}`;
}

export function formatInvoiceDate(dateStr) {
  if (!dateStr) return '—';
  const parts = String(dateStr).split('-');
  if (parts.length === 3) {
    const y = parts[0];
    const m = parseInt(parts[1], 10) - 1;
    const d = parseInt(parts[2], 10);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${d}-${months[m] || parts[1]}-${String(y).slice(-2)}`;
  }
  const dt = new Date(dateStr);
  if (isNaN(dt.getTime())) return dateStr;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${dt.getDate()}-${months[dt.getMonth()]}-${String(dt.getFullYear()).slice(-2)}`;
}

export function formatDate(dateStr) {
  if (!dateStr) return '—';
  try {
    const dt = new Date(dateStr);
    if (isNaN(dt.getTime())) return String(dateStr);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const d = dt.getDate();
    const m = months[dt.getMonth()];
    const y = dt.getFullYear();
    if (String(dateStr).includes('T') || String(dateStr).includes(':')) {
      const hh = String(dt.getHours()).padStart(2, '0');
      const mm = String(dt.getMinutes()).padStart(2, '0');
      return `${d} ${m} ${y}, ${hh}:${mm}`;
    }
    return `${d} ${m} ${y}`;
  } catch {
    return String(dateStr);
  }
}

export function amountInWords(amount) {
  const num = Math.round(Number(amount || 0) * 100) / 100;
  if (num === 0) return 'Rupees Zero Only';

  const [rupeesStr, paiseStr] = num.toFixed(2).split('.');
  const rupees = parseInt(rupeesStr, 10);
  const paise = parseInt(paiseStr, 10);

  const units = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  const convertTwo = n => n < 20 ? units[n] : tens[Math.floor(n / 10)] + (n % 10 ? ' ' + units[n % 10] : '');
  const convertThree = n => (n >= 100 ? units[Math.floor(n / 100)] + ' Hundred ' : '') + convertTwo(n % 100);

  let temp = rupees;
  let words = '';

  const crores = Math.floor(temp / 10000000);
  temp %= 10000000;
  const lakhs = Math.floor(temp / 100000);
  temp %= 100000;
  const thousands = Math.floor(temp / 1000);
  temp %= 1000;
  const hundreds = temp;

  if (crores > 0) words += (crores > 99 ? convertThree(crores) : convertTwo(crores)) + ' Crore ';
  if (lakhs > 0) words += convertTwo(lakhs) + ' Lakh ';
  if (thousands > 0) words += convertTwo(thousands) + ' Thousand ';
  if (hundreds > 0) words += convertThree(hundreds) + ' ';

  words = words.trim();
  let result = words ? 'Rupees ' + words : 'Rupees Zero';

  if (paise > 0) {
    result += ' and ' + convertTwo(paise) + ' Paise';
  }

  return result + ' Only';
}

export function toast(message, type = 'success') {
  let container = $('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ'}</span> <div>${esc(message)}</div>`;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 300);
  }, 4000);
}

// Indian States & Union Territories Reference (with GST State Codes)
const INDIAN_STATES = [
  { code: '29', name: 'Karnataka' },
  { code: '27', name: 'Maharashtra' },
  { code: '07', name: 'Delhi' },
  { code: '33', name: 'Tamil Nadu' },
  { code: '36', name: 'Telangana' },
  { code: '32', name: 'Kerala' },
  { code: '24', name: 'Gujarat' },
  { code: '19', name: 'West Bengal' },
  { code: '09', name: 'Uttar Pradesh' },
  { code: '08', name: 'Rajasthan' },
  { code: '23', name: 'Madhya Pradesh' },
  { code: '37', name: 'Andhra Pradesh' },
  { code: '06', name: 'Haryana' },
  { code: '03', name: 'Punjab' },
  { code: '21', name: 'Odisha' },
  { code: '10', name: 'Bihar' },
  { code: '30', name: 'Goa' },
  { code: '18', name: 'Assam' }
];

// ============================================================================
// DATA LOADING
// ============================================================================
async function loadData() {
  if (!sb) return;
  try {
    const [cRes, iRes, pRes, sRes, prRes] = await Promise.all([
      sb.from('customers').select('*').order('name'),
      sb.from('invoices').select('*,customers(name,state_code,gstin)').order('created_at', { ascending: false }),
      sb.from('payments').select('*').order('payment_date', { ascending: false }),
      sb.from('company_settings').select('*').limit(1).maybeSingle(),
      state.user ? sb.from('profiles').select('role, full_name, is_active').eq('id', state.user.id).maybeSingle() : Promise.resolve({ data: null })
    ]);

    if (cRes?.error || sRes?.error) {
      console.warn('Supabase query error (tables may need migration):', cRes?.error?.message || sRes?.error?.message);
      state.supabaseNeedsMigration = true;
      const mock = createMockClient();
      const [mc, mi, mp, ms] = await Promise.all([
        mock.from('customers').select('*'),
        mock.from('invoices').select('*'),
        mock.from('payments').select('*'),
        mock.from('company_settings').select('*').limit(1).maybeSingle()
      ]);
      state.customers = mc.data || [];
      state.invoices = mi.data || [];
      state.payments = mp.data || [];
      state.settings = ms.data;
    } else {
      state.customers = cRes?.data || [];
      state.invoices = iRes?.data || [];
      state.payments = pRes?.data || [];
      state.settings = sRes?.data || {
        business_name: 'MS Management Consulting',
        issuer_name: 'MADHU M. S.',
        state_code: '29',
        address: 'SNO.125, 1ST FLOOR, 12TH CROSS 6TH MAIN, 3RD PHASE, J.P.NAGAR, BANGALORE-560078, KARNATAKA',
        phone: '9964287173',
        email: 'madhumsiddu@gmail.com',
        gstin: '29APEPM7494M1ZZ',
        pan: 'APEPM7494M',
        bank_name: 'STATE BANK OF INDIA',
        account_name: 'MADHU M S',
        account_number: '20300723746',
        ifsc: 'SBIN0007117',
        branch: 'JP NAGAR 1ST PHASE, BANGALORE KARNATAKA - 560078'
      };
    }

    if (prRes?.data) {
      if (prRes.data.is_active === false) {
        if (sb) await sb.auth.signOut();
        state.user = null;
        state.role = 'staff';
        toast('Your account has been deactivated. Please contact your administrator.', 'error');
        render();
        return;
      }
      state.role = prRes.data.role || 'staff';
      state.fullName = prRes.data.full_name || state.user?.user_metadata?.full_name || 'Team Member';
    } else if (state.user?.user_metadata?.role) {
      state.role = state.user.user_metadata.role;
      state.fullName = state.user.user_metadata.full_name || state.user.email?.split('@')[0] || 'Team Member';
    } else {
      state.role = 'staff';
      state.fullName = state.user?.email?.split('@')[0] || 'Team Member';
    }
  } catch (err) {
    console.warn('Error fetching data:', err);
  }
}

// ============================================================================
// NAVIGATION & SHELL
// ============================================================================
const NAV_ITEMS = [
  { name: 'Dashboard', icon: '📊' },
  { name: 'Create Invoice', icon: '📝' },
  { name: 'Invoice History', icon: '📑' },
  { name: 'Customer Master', icon: '🏢' },
  { name: 'Payment Tracking', icon: '💳' },
  { name: 'Reports & Analytics', icon: '📈' },
  { name: 'User Management', icon: '👥', adminOnly: true },
  { name: 'Company Settings', icon: '⚙️', adminOnly: true },
  { name: 'Profile', icon: '👤' }
];

function renderNav() {
  return NAV_ITEMS
    .filter(item => !item.adminOnly || state.role === 'admin')
    .map(item => `
      <button class="nav ${state.page === item.name ? 'active' : ''}" data-nav="${item.name}" data-tooltip="${item.name}" title="${item.name}">
        <span class="nav-icon">${item.icon}</span>
        <span class="nav-label">${item.name}</span>
      </button>
    `).join('');
}

function toggleSidebar(forceState) {
  const nextState = typeof forceState === 'boolean' ? forceState : !state.sidebarCollapsed;
  state.sidebarCollapsed = nextState;
  try {
    localStorage.setItem('sidebar_collapsed', nextState ? 'true' : 'false');
  } catch {}
  const shell = document.querySelector('.shell');
  shell?.classList.toggle('sidebar-collapsed', nextState);
}

function bindShellEvents() {
  document.querySelectorAll('[data-nav]').forEach(btn => {
    btn.onclick = () => {
      if (state.page === btn.dataset.nav && !state.editingCustomer && !state.editingInvoice) return;
      state.page = btn.dataset.nav;
      state.editingCustomer = null;
      state.editingInvoice = null;
      if (window.innerWidth <= 992) toggleSidebar(false);
      render();
    };
  });

  const userSnippet = $('#sidebarUserProfileSnippet');
  if (userSnippet) {
    userSnippet.onclick = () => {
      state.page = 'Profile';
      if (window.innerWidth <= 992) toggleSidebar(false);
      render();
    };
  }

  const quickThemeToggle = $('#quickThemeToggle');
  if (quickThemeToggle) {
    quickThemeToggle.onclick = () => {
      const nextTheme = state.theme === 'light' ? 'dark' : 'light';
      applyTheme(nextTheme);
      render();
      toast(nextTheme === 'light' ? 'Light mode activated.' : 'Dark mode activated.', 'info');
    };
  }

  const logoutBtn = $('#logoutBtn');
  if (logoutBtn) {
    logoutBtn.onclick = async () => {
      try {
        const sessionRes = await sb?.auth?.getSession();
        const token = sessionRes?.data?.session?.access_token;
        if (token) {
          await fetch('/api/audit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ action: 'CLIENT_SIGN_OUT_REPORTED', details: { source: 'sidebar_button' } })
          }).catch(() => {});
        }
      } catch (e) {}
      if (sb) await sb.auth.signOut();
      state.user = null;
      toast('Signed out successfully', 'info');
      render();
    };
  }

  const menuToggle = $('#menuToggle');
  if (menuToggle) {
    menuToggle.onclick = () => toggleSidebar();
  }

  const sidebarCollapseBtn = $('#sidebarCollapseBtn');
  if (sidebarCollapseBtn) {
    sidebarCollapseBtn.onclick = () => toggleSidebar(true);
  }

  const sidebarBackdrop = $('#sidebarBackdrop');
  if (sidebarBackdrop) {
    sidebarBackdrop.onclick = () => toggleSidebar(false);
  }
}

function layout(content, title = state.page, headerAction = '') {
  const app = $('#app');
  let shell = app.querySelector('.shell');

  if (!shell) {
    app.innerHTML = `
      <div class="shell ${state.sidebarCollapsed ? 'sidebar-collapsed' : ''}">
        <aside class="side">
          <div class="brand">
            <div class="brand-left" style="display:flex;align-items:center;gap:12px;min-width:0">
              <img src="/assets/logo.png" alt="MS Consulting Logo">
              <div>
                <div class="brand-title">MS Consulting</div>
                <small>Billing & Invoicing</small>
              </div>
            </div>
            <button class="sidebar-collapse-btn" id="sidebarCollapseBtn" title="Close Navigation Sidebar" aria-label="Close Navigation">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
          <div class="nav-group">
            ${renderNav()}
          </div>
          <div class="side-footer">
            <div class="user-snippet" id="sidebarUserProfileSnippet" data-tooltip="${esc(state.fullName || 'User')}" title="${esc(state.fullName || 'User')}" style="cursor:pointer">
              <div class="user-avatar">${(state.fullName || state.user?.email || 'U')[0].toUpperCase()}</div>
              <div class="user-details">
                <div class="user-name">${esc(state.fullName || state.user?.email?.split('@')[0])}</div>
                <span class="user-role-badge role-${state.role}">${state.role}</span>
              </div>
            </div>
            <button class="nav" id="logoutBtn" data-tooltip="Sign Out" title="Sign Out" style="color:var(--danger-red)">
              <span class="nav-icon">🚪</span>
              <span class="nav-label">Sign Out</span>
            </button>
          </div>
        </aside>
        <div class="sidebar-backdrop" id="sidebarBackdrop"></div>
        <main class="main">
          <header class="top">
            <div class="row" style="align-items:center;gap:14px">
              <button class="nav-toggle-btn" id="menuToggle" title="Toggle Navigation Menu" aria-label="Toggle Navigation">
                <svg class="hamburger-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="3" y1="6" x2="21" y2="6"></line>
                  <line x1="3" y1="12" x2="21" y2="12"></line>
                  <line x1="3" y1="18" x2="21" y2="18"></line>
                </svg>
              </button>
              <div>
                <h1 id="pageTitleHeading">${title}</h1>
                <div class="sub">MS Management Consulting • ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
              </div>
            </div>
            <div class="row" style="align-items:center;gap:12px">
              <button class="btn-theme-quick" id="quickThemeToggle" title="Toggle display theme (Light / Dark)">
                <span class="theme-quick-icon">${state.theme === 'light' ? '☀️' : '🌙'}</span>
                <span>${state.theme === 'light' ? 'Light' : 'Dark'}</span>
                <span class="theme-quick-pill">${state.theme.startsWith('colorful') ? 'Color' : (state.theme === 'dark' ? 'Dark' : 'Light')}</span>
              </button>
              <div id="pageHeaderActionContainer">${headerAction}</div>
            </div>
          </header>
          <div id="migrationAlertContainer">
            ${state.supabaseNeedsMigration ? `
              <div class="alert info" style="margin-bottom:20px;display:flex;justify-content:space-between;align-items:center;background:#EBF3FC;border:1px solid #B9D5F3;color:#0B3866;padding:12px 18px;border-radius:8px">
                <div>
                  <strong>⚡ Supabase Database Connected!</strong><br>
                  <span style="font-size:13px">Database connected to <code>${esc(supabaseUrl || 'Supabase')}</code>. Tables (customers, invoices, company_settings) have not yet been migrated in Supabase SQL editor. Operating with authentic verified local data.</span>
                </div>
                <button type="button" class="btn small primary" id="btnCopySqlMigration" style="white-space:nowrap;margin-left:16px">📋 SQL Migration Guide</button>
              </div>
            ` : ''}
          </div>
          <div id="pageMainContentContainer">${content}</div>
        </main>
      </div>
    `;

    bindShellEvents();
  } else {
    // Fast path: Update page title and content instantly without rebuilding sidebar DOM
    const heading = document.getElementById('pageTitleHeading');
    if (heading) heading.textContent = title;

    const actionContainer = document.getElementById('pageHeaderActionContainer');
    if (actionContainer) actionContainer.innerHTML = headerAction;

    const contentContainer = document.getElementById('pageMainContentContainer');
    if (contentContainer) contentContainer.innerHTML = content;

    // Update active nav button
    document.querySelectorAll('[data-nav]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.nav === state.page);
    });

    // Close mobile drawer if open
    if (window.innerWidth <= 992) {
      toggleSidebar(false);
    }
  }

  const btnMigration = $('#btnCopySqlMigration');
  if (btnMigration) {
    btnMigration.onclick = () => {
      const projMatch = (supabaseUrl || '').match(/https:\/\/([^.]+)\.supabase\.co/);
      const projUrl = projMatch ? `https://supabase.com/dashboard/project/${projMatch[1]}` : 'https://supabase.com/dashboard';
      alert(`To initialize Supabase database:\n1. Open your Supabase Dashboard: ${projUrl}\n2. Click on "SQL Editor" on the left menu.\n3. Open the file "supabase/schema.sql", copy all contents, paste into the SQL Editor, and click "Run".\n\nOnce run, all tables and schema policies will be live in Supabase!`);
    };
  }
}

// ============================================================================
// 1. DASHBOARD
// ============================================================================
function dashboard() {
  const currentFY = state.dashboardFY || financialYear();
  const fyInvoices = state.invoices.filter(i => !currentFY || i.financial_year === currentFY);
  
  const totalInvoices = fyInvoices.length;
  const totalBilled = fyInvoices.filter(i => i.status !== 'cancelled').reduce((acc, i) => acc + Number(i.total), 0);
  const totalReceived = state.payments.filter(p => fyInvoices.some(i => i.id === p.invoice_id)).reduce((acc, p) => acc + Number(p.amount), 0);
  const totalOutstanding = Math.max(0, totalBilled - totalReceived);
  
  const todayStr = new Date().toISOString().slice(0, 10);
  const overdueInvoices = fyInvoices.filter(i => (i.status === 'unpaid' || i.status === 'partial') && i.due_date && i.due_date < todayStr).length;

  const currentMonthKey = new Date().toISOString().slice(0, 7);
  const curMonthBilling = fyInvoices.filter(i => i.invoice_date?.slice(0, 7) === currentMonthKey && i.status !== 'cancelled').reduce((acc, i) => acc + Number(i.total), 0);

  const content = `
    <div class="row between" style="margin-bottom:20px">
      <div class="row">
        <label style="font-size:13px;font-weight:700">Financial Year Filter:</label>
        <select id="dashFY" style="max-width:180px">
          <option value="">All Financial Years</option>
          ${['2026-27', '2025-26', '2024-25'].map(fy => `<option value="${fy}" ${currentFY === fy ? 'selected' : ''}>FY ${fy}</option>`).join('')}
        </select>
      </div>
      <div class="row">
        <button class="btn" id="dashCreateBtn">+ Create Invoice</button>
        <button class="btn secondary" id="dashCustBtn">+ Add Customer</button>
      </div>
    </div>

    <div class="cards-6">
      <div class="card">
        <div class="label">Total Invoices <span>📄</span></div>
        <div class="metric">${totalInvoices}</div>
        <div class="metric-sub">FY ${currentFY}</div>
      </div>
      <div class="card">
        <div class="label">Total Invoiced <span>💼</span></div>
        <div class="metric" style="color:var(--primary-blue)">${money(totalBilled)}</div>
        <div class="metric-sub">Gross billed value</div>
      </div>
      <div class="card">
        <div class="label">Collections <span>✓</span></div>
        <div class="metric" style="color:var(--success-green)">${money(totalReceived)}</div>
        <div class="metric-sub">Settled payments</div>
      </div>
      <div class="card">
        <div class="label">Outstanding <span>⏳</span></div>
        <div class="metric" style="color:var(--warning-amber)">${money(totalOutstanding)}</div>
        <div class="metric-sub">Balance receivables</div>
      </div>
      <div class="card">
        <div class="label">Overdue <span>⚠️</span></div>
        <div class="metric" style="color:var(--danger-red)">${overdueInvoices}</div>
        <div class="metric-sub">Past due date</div>
      </div>
      <div class="card">
        <div class="label">This Month <span>📈</span></div>
        <div class="metric" style="color:#7557B2">${money(curMonthBilling)}</div>
        <div class="metric-sub">${new Date().toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}</div>
      </div>
    </div>

    <div class="grid2" style="margin-bottom:24px">
      <div class="panel">
        <h3>Monthly Billing Trend (₹)</h3>
        <div class="chart-box">
          <canvas id="billingChart"></canvas>
        </div>
      </div>
      <div class="panel">
        <h3>Payment Collections Trend (₹)</h3>
        <div class="chart-box">
          <canvas id="collectionsChart"></canvas>
        </div>
      </div>
    </div>

    <div class="grid2">
      <div class="panel">
        <div class="row between">
          <h3>Recent Invoices</h3>
          <button class="link" data-nav="Invoice History">View all &rarr;</button>
        </div>
        ${renderRecentInvoicesTable(fyInvoices.slice(0, 5))}
      </div>
      <div class="panel">
        <div class="row between">
          <h3>Recent Payments</h3>
          <button class="link" data-nav="Payment Tracking">View all &rarr;</button>
        </div>
        ${renderRecentPaymentsTable(state.payments.slice(0, 5))}
      </div>
    </div>
  `;

  layout(content, 'Billing Dashboard');

  $('#dashFY').onchange = e => {
    state.dashboardFY = e.target.value;
    dashboard();
  };
  $('#dashCreateBtn').onclick = () => { state.page = 'Create Invoice'; state.editingInvoice = null; render(); };
  $('#dashCustBtn').onclick = () => { state.page = 'Customer Master'; state.editingCustomer = null; render(); };

  initDashboardCharts(fyInvoices);
}

function initDashboardCharts(invoices) {
  // Monthly billing chart
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 5 + i);
    return { label: d.toLocaleDateString('en-IN', { month: 'short' }), key: d.toISOString().slice(0, 7) };
  });

  const billingValues = months.map(m =>
    invoices.filter(i => i.invoice_date?.slice(0, 7) === m.key && i.status !== 'cancelled').reduce((acc, i) => acc + Number(i.total), 0)
  );

  const collValues = months.map(m =>
    state.payments.filter(p => p.payment_date?.slice(0, 7) === m.key).reduce((acc, p) => acc + Number(p.amount), 0)
  );

  const billingCtx = document.getElementById('billingChart')?.getContext('2d');
  if (billingCtx) {
    if (state.activeCharts.billing) state.activeCharts.billing.destroy();
    state.activeCharts.billing = new Chart(billingCtx, {
      type: 'bar',
      data: {
        labels: months.map(m => m.label),
        datasets: [{
          label: 'Invoiced (₹)',
          data: billingValues,
          backgroundColor: '#1769AA',
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { callback: v => '₹' + (v >= 1000 ? (v / 1000) + 'k' : v) }
          }
        }
      }
    });
  }

  const collCtx = document.getElementById('collectionsChart')?.getContext('2d');
  if (collCtx) {
    if (state.activeCharts.coll) state.activeCharts.coll.destroy();
    state.activeCharts.coll = new Chart(collCtx, {
      type: 'line',
      data: {
        labels: months.map(m => m.label),
        datasets: [{
          label: 'Received (₹)',
          data: collValues,
          borderColor: '#15856A',
          backgroundColor: 'rgba(21, 133, 106, 0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: 5
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { callback: v => '₹' + (v >= 1000 ? (v / 1000) + 'k' : v) }
          }
        }
      }
    });
  }
}

function renderRecentInvoicesTable(items) {
  if (!items.length) return `<div class="empty">No invoices found. Click '+ Create Invoice' to issue your first invoice.</div>`;
  return `
    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>Invoice</th>
            <th>Customer</th>
            <th>Date</th>
            <th>Status</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          ${items.map(x => `
            <tr>
              <td><strong>${esc(x.invoice_number)}</strong></td>
              <td>${esc(x.customers?.name || '—')}</td>
              <td>${esc(x.invoice_date)}</td>
              <td><span class="tag ${x.status}">${esc(x.status)}</span></td>
              <td><strong>${money(x.total)}</strong></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderRecentPaymentsTable(items) {
  if (!items.length) return `<div class="empty">No payment records yet.</div>`;
  return `
    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Invoice</th>
            <th>Mode</th>
            <th>UTR / Ref</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          ${items.map(p => `
            <tr>
              <td>${esc(p.payment_date)}</td>
              <td><strong>${esc(state.invoices.find(i => i.id === p.invoice_id)?.invoice_number || '—')}</strong></td>
              <td>${esc(p.method)}</td>
              <td><code style="font-family:var(--font-mono);font-size:12px">${esc(p.reference || '—')}</code></td>
              <td><strong style="color:var(--success-green)">${money(p.amount)}</strong></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// ============================================================================
// 2. CREATE / EDIT INVOICE
// ============================================================================
function invoiceForm() {
  const inv = state.editingInvoice;
  const isEditing = Boolean(inv);
  const currentFY = inv?.financial_year || financialYear();

  let lineItems = inv?.items?.length ? inv.items : [
    { description: 'Professional Services for Management Consultancy', hsn_sac: '998312', quantity: 1, unit_price: 50000, discount: 0, amount: 50000 }
  ];

  const content = `
    <div class="panel">
      <div class="notice">
        <strong>GST Rules Enforced:</strong> Indian GST is automatically calculated based on place of supply. Intrastate supply (within Karnataka, State Code 29) triggers <strong>CGST + SGST</strong>; Interstate supply triggers <strong>IGST</strong>.
      </div>

      <form id="invCreateForm">
        <div class="row">
          <div class="field">
            <label>Customer / Client <span class="req">*</span></label>
            <select name="customer_id" id="invCustomerSelect" required>
              <option value="">-- Choose Customer --</option>
              ${state.customers.map(c => `<option value="${c.id}" ${inv?.customer_id === c.id ? 'selected' : ''}>${esc(c.name)} (${esc(c.state || 'Karnataka')} - ${esc(c.state_code || '29')})</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label>Invoice Date <span class="req">*</span></label>
            <input type="date" name="invoice_date" value="${inv?.invoice_date || new Date().toISOString().slice(0, 10)}" required>
          </div>
          <div class="field">
            <label>Payment Due Date</label>
            <input type="date" name="due_date" value="${inv?.due_date || new Date(Date.now() + 86400000 * 15).toISOString().slice(0, 10)}">
          </div>
          <div class="field">
            <label>Financial Year</label>
            <input type="text" name="financial_year" value="${currentFY}" readonly style="background:var(--bg-subtle)">
          </div>
        </div>

        <div class="row">
          <div class="field" style="flex:2">
            <label>Billing Address</label>
            <input type="text" id="invBillingAddr" value="" placeholder="Selected customer address will appear here" readonly style="background:var(--bg-subtle)">
          </div>
          <div class="field">
            <label>Customer GSTIN</label>
            <input type="text" id="invCustomerGstin" value="" placeholder="Customer GSTIN" readonly style="background:var(--bg-subtle);font-family:var(--font-mono)">
          </div>
          <div class="field">
            <label>Place of Supply</label>
            <input type="text" name="place_of_supply" id="invPlaceOfSupply" value="Karnataka (29)">
          </div>
        </div>

        <h3 style="margin-top:20px">Invoice Particulars / Line Items</h3>
        <div class="table-container items-table">
          <table>
            <thead>
              <tr>
                <th style="width:40%">Particulars / Description</th>
                <th>HSN/SAC</th>
                <th style="width:10%">Qty</th>
                <th style="width:16%">Rate (₹)</th>
                <th style="width:16%">Amount (₹)</th>
                <th style="width:6%"></th>
              </tr>
            </thead>
            <tbody id="lineItemsBody">
              <!-- Dynamically populated -->
            </tbody>
          </table>
        </div>
        <button type="button" class="btn secondary small" id="addItemBtn" style="margin-bottom:16px">+ Add Line Item</button>

        <div class="grid2">
          <div>
            <div class="field">
              <label>Payment Terms</label>
              <textarea name="payment_terms" rows="2">${esc(inv?.payment_terms || state.settings?.payment_terms || 'Payment due within 15 days.')}</textarea>
            </div>
            <div class="field">
              <label>Notes / Remarks</label>
              <textarea name="notes" rows="2" placeholder="Optional notes for client">${esc(inv?.notes || '')}</textarea>
            </div>
          </div>
          <div>
            <div class="row">
              <div class="field">
                <label>Overall Discount (₹)</label>
                <input type="number" id="invDiscount" value="${inv?.discount || 0}" min="0" step="0.01">
              </div>
              <div class="field">
                <label>GST Rate (%)</label>
                <select id="invGstRate">
                  <option value="18" ${inv?.gst_rate === 18 ? 'selected' : ''}>18% (Standard Consulting)</option>
                  <option value="12" ${inv?.gst_rate === 12 ? 'selected' : ''}>12%</option>
                  <option value="5" ${inv?.gst_rate === 5 ? 'selected' : ''}>5%</option>
                  <option value="0" ${inv?.gst_rate === 0 ? 'selected' : ''}>0% (Exempt)</option>
                </select>
              </div>
            </div>

            <div class="calc-box">
              <div class="calc-title" id="calcBreakdown">Subtotal: ₹0.00 | Tax: ₹0.00</div>
              <div class="calc-total" id="calcTotal">₹0.00</div>
              <div class="calc-words" id="calcWords">Rupees Zero Only</div>
            </div>
          </div>
        </div>

        <div class="row" style="margin-top:20px;justify-content:flex-end;gap:12px">
          <button type="button" class="btn secondary" id="saveDraftBtn">Save as Draft</button>
          <button type="submit" class="btn" id="finalizeInvoiceBtn">${isEditing ? 'Update & Finalize Tax Invoice' : 'Finalize & Issue Tax Invoice'}</button>
        </div>
      </form>
    </div>
  `;

  layout(content, isEditing ? `Edit Invoice: ${inv.invoice_number}` : 'Create New Invoice');

  // Populate line items
  const renderItems = () => {
    $('#lineItemsBody').innerHTML = lineItems.map((item, idx) => `
      <tr data-idx="${idx}">
        <td><input type="text" class="item-desc" value="${esc(item.description)}" required></td>
        <td><input type="text" class="item-hsn" value="${esc(item.hsn_sac || '998312')}" style="font-family:var(--font-mono)"></td>
        <td><input type="number" class="item-qty" value="${item.quantity || 1}" min="1" step="0.5" required></td>
        <td><input type="number" class="item-price" value="${item.unit_price || 0}" min="0" step="0.01" required></td>
        <td><strong class="item-amount">${money(item.quantity * item.unit_price)}</strong></td>
        <td>${lineItems.length > 1 ? `<button type="button" class="link remove-item" style="color:var(--danger-red);font-weight:700">✕</button>` : ''}</td>
      </tr>
    `).join('');

    document.querySelectorAll('.remove-item').forEach(b => {
      b.onclick = e => {
        const idx = Number(e.target.closest('tr').dataset.idx);
        lineItems.splice(idx, 1);
        renderItems();
        recalculate();
      };
    });

    document.querySelectorAll('.item-qty, .item-price, .item-desc, .item-hsn').forEach(input => {
      input.oninput = () => {
        const row = input.closest('tr');
        const idx = Number(row.dataset.idx);
        const qty = Number(row.querySelector('.item-qty').value) || 0;
        const rate = Number(row.querySelector('.item-price').value) || 0;
        lineItems[idx].description = row.querySelector('.item-desc').value;
        lineItems[idx].hsn_sac = row.querySelector('.item-hsn').value;
        lineItems[idx].quantity = qty;
        lineItems[idx].unit_price = rate;
        lineItems[idx].amount = qty * rate;
        row.querySelector('.item-amount').textContent = money(qty * rate);
        recalculate();
      };
    });
  };

  $('#addItemBtn').onclick = () => {
    lineItems.push({ description: 'Consulting Advisory Services', hsn_sac: '998312', quantity: 1, unit_price: 25000, discount: 0, amount: 25000 });
    renderItems();
    recalculate();
  };

  const syncCustomerDetails = () => {
    const custId = $('#invCustomerSelect').value;
    const cust = state.customers.find(c => c.id === custId);
    if (cust) {
      $('#invBillingAddr').value = `${cust.billing_address || ''}, ${cust.city || ''}, ${cust.state || ''} ${cust.pin_code || ''}`.trim();
      $('#invCustomerGstin').value = cust.gstin || 'Unregistered / None';
      $('#invPlaceOfSupply').value = `${cust.state || 'Karnataka'} (${cust.state_code || '29'})`;
    } else {
      $('#invBillingAddr').value = '';
      $('#invCustomerGstin').value = '';
    }
    recalculate();
  };

  $('#invCustomerSelect').onchange = syncCustomerDetails;
  $('#invDiscount').oninput = recalculate;
  $('#invGstRate').onchange = recalculate;

  function recalculate() {
    const custId = $('#invCustomerSelect').value;
    const cust = state.customers.find(c => c.id === custId);
    const subtotal = lineItems.reduce((acc, it) => acc + (Number(it.quantity || 0) * Number(it.unit_price || 0)), 0);
    const discount = Number($('#invDiscount').value) || 0;
    const taxable = Math.max(0, subtotal - discount);
    const gstRate = Number($('#invGstRate').value) || 0;

    const supplierState = state.settings?.state_code || '29';
    const customerState = cust?.state_code || '29';
    const isIntrastate = supplierState === customerState;

    let taxType = 'EXEMPT';
    let cgst = 0, sgst = 0, igst = 0, taxAmount = 0;

    if (gstRate > 0) {
      if (isIntrastate) {
        taxType = 'CGST + SGST';
        cgst = Math.round(taxable * (gstRate / 2) / 100 * 100) / 100;
        sgst = Math.round(taxable * (gstRate / 2) / 100 * 100) / 100;
        taxAmount = cgst + sgst;
      } else {
        taxType = 'IGST';
        igst = Math.round(taxable * gstRate / 100 * 100) / 100;
        taxAmount = igst;
      }
    }

    const grandTotal = taxable + taxAmount;
    const words = amountInWords(grandTotal);

    $('#calcBreakdown').textContent = `Taxable: ${money(taxable)} | ${taxType} (${gstRate}%): ${money(taxAmount)}`;
    $('#calcTotal').textContent = money(grandTotal);
    $('#calcWords').textContent = words;

    return { subtotal, discount, taxable, gstRate, taxType, cgst, sgst, igst, taxAmount, grandTotal, words };
  }

  renderItems();
  syncCustomerDetails();

  let isSavingInvoice = false;

  const handleSave = async (isDraft = false) => {
    if (isSavingInvoice) return;

    const custId = $('#invCustomerSelect').value;
    if (!custId) {
      toast('Please select a customer for this invoice.', 'error');
      $('#invCustomerSelect').focus();
      return;
    }

    if (!lineItems || lineItems.length === 0) {
      toast('At least one line item is required to save an invoice.', 'error');
      return;
    }

    const calcs = recalculate();
    const form = $('#invCreateForm');
    const fData = Object.fromEntries(new FormData(form));

    // Clear confirmation dialog before final issuance
    if (!isDraft) {
      const confirmed = window.confirm(
        `Are you sure you want to finalize and issue this Tax Invoice for ${money(calcs.grandTotal)}?\n\nOnce issued, an official permanent GST invoice number will be allocated and all financial records will become permanently immutable.`
      );
      if (!confirmed) return;
    }

    const finalizeBtn = $('#finalizeInvoiceBtn');
    const draftBtn = $('#saveDraftBtn');
    const prevFinalizeText = finalizeBtn ? finalizeBtn.textContent : '';
    const prevDraftText = draftBtn ? draftBtn.textContent : '';

    isSavingInvoice = true;
    if (finalizeBtn) finalizeBtn.disabled = true;
    if (draftBtn) draftBtn.disabled = true;
    if (isDraft && draftBtn) draftBtn.textContent = 'Saving Draft...';
    if (!isDraft && finalizeBtn) finalizeBtn.textContent = 'Issuing Invoice...';

    try {
      const { data: rpcData, error: rpcErr } = await sb.rpc('create_invoice_with_items', {
        p_customer_id: custId,
        p_invoice_date: fData.invoice_date,
        p_due_date: fData.due_date,
        p_financial_year: fData.financial_year,
        p_place_of_supply: fData.place_of_supply,
        p_discount: Number(fData.discount || calcs.discount || 0),
        p_gst_rate: Number(calcs.gstRate),
        p_payment_terms: fData.payment_terms || '',
        p_notes: fData.notes || '',
        p_is_draft: isDraft,
        p_items: lineItems.map(it => ({
          description: it.description,
          hsn_sac: it.hsn_sac || '998312',
          quantity: Number(it.quantity || 1),
          unit_price: Number(it.unit_price || 0),
          discount: Number(it.discount || 0)
        })),
        p_invoice_id: isEditing ? inv.id : null
      });
      if (rpcErr) throw rpcErr;

      const issuedNumber = rpcData?.invoice_number || (isDraft ? 'Draft' : 'Tax Invoice');
      toast(
        isDraft
          ? `Invoice draft saved successfully: ${issuedNumber}`
          : `Tax Invoice finalized and issued successfully: ${issuedNumber}`,
        'success'
      );

      state.editingInvoice = null;
      state.page = 'Invoice History';
      await loadData();
      render();
    } catch (err) {
      console.error(err);
      const errMsg = String(err.message || err);
      let userMsg = 'Error saving invoice. Please verify your inputs and try again.';
      if (/unauthorized|active user session/i.test(errMsg)) {
        userMsg = 'Access Denied: You must be an active team member (Admin or Staff) to create or finalize invoices.';
      } else if (/issuer name must be configured/i.test(errMsg)) {
        userMsg = 'Company Details Incomplete: Issuer Name must be configured in Company Settings before finalizing a Tax Invoice.';
      } else if (/immutable/i.test(errMsg)) {
        userMsg = 'Finalized invoices are strictly immutable. Line items cannot be added, edited, or removed.';
      } else if (/inactive customer/i.test(errMsg)) {
        userMsg = 'Cannot issue invoice: The selected customer is currently marked inactive.';
      }
      toast(userMsg, 'error');
    } finally {
      isSavingInvoice = false;
      if (finalizeBtn) {
        finalizeBtn.disabled = false;
        finalizeBtn.textContent = prevFinalizeText;
      }
      if (draftBtn) {
        draftBtn.disabled = false;
        draftBtn.textContent = prevDraftText;
      }
    }
  };

  $('#invCreateForm').onsubmit = e => {
    e.preventDefault();
    handleSave(false);
  };
  $('#saveDraftBtn').onclick = () => handleSave(true);
}

// ============================================================================
// 3. INVOICE HISTORY
// ============================================================================
function history() {
  const content = `
    <div class="panel">
      <div class="row between" style="margin-bottom:16px">
        <div class="row">
          <input type="text" id="histSearch" placeholder="Search invoice number or customer..." style="max-width:280px">
          <select id="histStatusFilter" style="max-width:160px">
            <option value="">All Statuses</option>
            <option value="unpaid">Unpaid</option>
            <option value="partial">Partially Paid</option>
            <option value="paid">Paid</option>
            <option value="draft">Draft</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <select id="histFYFilter" style="max-width:160px">
            <option value="">All FY</option>
            <option value="2026-27">FY 2026-27</option>
            <option value="2025-26">FY 2025-26</option>
          </select>
        </div>
        <button class="btn" id="histCreateBtn">+ Create Invoice</button>
      </div>

      <div id="histTableContainer"></div>
    </div>
  `;

  layout(content, 'Invoice Management & History');

  $('#histCreateBtn').onclick = () => {
    state.page = 'Create Invoice';
    state.editingInvoice = null;
    render();
  };

  const renderTable = () => {
    const q = $('#histSearch').value.toLowerCase();
    const st = $('#histStatusFilter').value;
    const fy = $('#histFYFilter').value;

    const filtered = state.invoices.filter(i => {
      const matchQ = i.invoice_number?.toLowerCase().includes(q) || i.customers?.name?.toLowerCase().includes(q);
      const matchSt = !st || i.status === st;
      const matchFY = !fy || i.financial_year === fy;
      return matchQ && matchSt && matchFY;
    });

    if (!filtered.length) {
      $('#histTableContainer').innerHTML = `<div class="empty">No invoices matched your search and filter criteria.</div>`;
      return;
    }

    $('#histTableContainer').innerHTML = `
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Invoice No</th>
              <th>Customer</th>
              <th>Invoice Date</th>
              <th>Due Date</th>
              <th>Status</th>
              <th>Total Value</th>
              <th style="text-align:right">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.map(x => {
              const acts = invoiceHistoryActions(x, state.role);
              return `
              <tr>
                <td><strong>${esc(x.invoice_number)}</strong></td>
                <td>${esc(x.customers?.name || '—')}</td>
                <td>${esc(x.invoice_date)}</td>
                <td>${esc(x.due_date || '—')}</td>
                <td><span class="tag ${x.status}">${esc(x.status)}</span></td>
                <td><strong>${money(x.total)}</strong></td>
                <td>
                  <div class="actions">
                    ${acts.includes('view') ? `<button class="btn secondary small" data-view="${x.id}" title="View details">View</button>` : ''}
                    ${acts.includes('edit') ? `<button class="btn secondary small" data-edit="${x.id}">Edit</button>` : ''}
                    ${acts.includes('pdf') ? `<button class="btn secondary small" data-pdf="${x.id}" title="Download PDF">PDF</button>` : ''}
                    ${acts.includes('cancel') ? `<button class="btn secondary small" data-cancelinv="${x.id}" style="color:var(--warning-amber)" title="Cancel ${x.is_draft ? 'Draft' : 'Invoice'}">Cancel</button>` : ''}
                    ${acts.includes('delete_draft') ? `<button class="btn secondary small" data-deletedraft="${x.id}" style="color:var(--danger-red)" title="${x.is_draft ? 'Delete Draft' : 'Delete Invoice'}">${x.is_draft ? 'Delete Draft' : 'Delete'}</button>` : ''}
                  </div>
                </td>
              </tr>
            `;}).join('')}
          </tbody>
        </table>
      </div>
    `;

    document.querySelectorAll('[data-pdf]').forEach(b => {
      b.onclick = () => {
        const inv = state.invoices.find(i => i.id === b.dataset.pdf);
        if (inv) generateInvoicePDF(inv);
      };
    });

    document.querySelectorAll('[data-view]').forEach(b => {
      b.onclick = () => {
        const inv = state.invoices.find(i => i.id === b.dataset.view);
        if (inv) showInvoiceDetailsModal(inv);
      };
    });

    document.querySelectorAll('[data-edit]').forEach(b => {
      b.onclick = () => {
        const inv = state.invoices.find(i => i.id === b.dataset.edit);
        state.editingInvoice = inv;
        state.page = 'Create Invoice';
        render();
      };
    });

    document.querySelectorAll('[data-deletedraft]').forEach(b => {
      b.onclick = async () => {
        const inv = state.invoices.find(i => i.id === b.dataset.deletedraft);
        if (!inv) return;

        // Check if invoice has payments
        const invPayments = (state.payments || []).filter(p => p.invoice_id === inv.id);
        if (invPayments.length > 0) {
          toast(`Cannot delete invoice ${inv.invoice_number} because it has ${invPayments.length} associated payment record(s). Please delete all payments in Payment Tracking first.`, 'error');
          return;
        }

        const confirmed = await showDeleteDraftModal(inv);
        if (!confirmed) return;

        try {
          let token = null;
          try {
            const session = await sb.auth.getSession();
            token = session?.data?.session?.access_token;
          } catch {}

          if (token && !state.mockMode) {
            const res = await fetch('/api/invoices', {
              method: 'DELETE',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
              },
              body: JSON.stringify({ id: inv.id })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to delete invoice.');
          } else {
            await sb.from('invoice_items').delete().eq('invoice_id', inv.id);
            const { error: delErr } = await sb.from('invoices').delete().eq('id', inv.id);
            if (delErr) throw delErr;
          }

          const itemType = inv.status === 'cancelled'
            ? (inv.is_draft ? 'Cancelled draft' : 'Cancelled invoice')
            : (inv.is_draft ? 'Draft' : 'Invoice');
          toast(`${itemType} ${inv.invoice_number} deleted permanently`, 'info');
          await loadData();
          render();
        } catch (err) {
          toast('Error deleting: ' + (err.message || String(err)), 'error');
        }
      };
    });

    document.querySelectorAll('[data-cancelinv]').forEach(b => {
      b.onclick = async () => {
        const inv = state.invoices.find(i => i.id === b.dataset.cancelinv);
        if (!inv) return;
        const reason = await showCancelInvoiceModal(inv);
        if (!reason || !reason.trim()) return;

        try {
          const { error: rpcErr } = await sb.rpc('cancel_invoice', {
            p_invoice_id: inv.id,
            p_reason: reason.trim()
          });
          if (rpcErr) throw rpcErr;

          toast(`${inv.is_draft ? 'Draft' : 'Invoice'} ${inv.invoice_number} cancelled`, 'info');
          await loadData();
          render();
        } catch (err) {
          toast('Error cancelling invoice: ' + (err.message || String(err)), 'error');
        }
      };
    });
  };

  $('#histSearch').oninput = renderTable;
  $('#histStatusFilter').onchange = renderTable;
  $('#histFYFilter').onchange = renderTable;

  renderTable();
}

function showDeleteDraftModal(inv) {
  return new Promise(resolve => {
    const existing = document.getElementById('deleteDraftOverlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'modern-confirm-overlay';
    overlay.id = 'deleteDraftOverlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'confirmTitle');

    const customerName = inv.customers?.name || (inv.customer_id ? (state.customers?.find(c => c.id === inv.customer_id)?.name) : null);

    overlay.innerHTML = `
      <div class="modern-confirm-modal">
        <div class="modern-confirm-body">
          <div class="confirm-modal-top">
            <div class="confirm-badge-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 6h18"/>
                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
                <line x1="10" x2="10" y1="11" y2="17"/>
                <line x1="14" x2="14" y1="11" y2="17"/>
              </svg>
            </div>
            <button class="modal-close" id="confirmCloseBtn" type="button" aria-label="Close dialog">&times;</button>
          </div>

          <h3 class="confirm-modal-title" id="confirmTitle">${inv.status === 'cancelled' ? (inv.is_draft ? 'Delete Cancelled Draft' : 'Delete Cancelled Invoice') : (inv.is_draft ? 'Delete Draft Permanently' : 'Delete Invoice Permanently')}</h3>
          <p class="confirm-modal-prompt">
            Are you sure you want to delete ${inv.status === 'cancelled' ? 'cancelled ' + (inv.is_draft ? 'draft' : 'invoice') : (inv.is_draft ? 'draft' : 'invoice')} <span class="confirm-target-chip">${esc(inv.invoice_number)}</span> permanently?
          </p>

          <div class="confirm-warning-banner">
            <div class="warning-banner-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
                <line x1="12" x2="12" y1="9" y2="13"/>
                <line x1="12" x2="12.01" y1="17" y2="17"/>
              </svg>
            </div>
            <div class="warning-banner-text">
              <strong>This action cannot be undone.</strong>
              <span>${inv.status === 'cancelled' ? 'This cancelled record and all associated line items will be removed permanently.' : (inv.is_draft ? 'All line items and draft details linked to this invoice will be removed permanently.' : 'This issued invoice and all associated line items will be removed permanently.')}</span>
            </div>
          </div>

          <div class="confirm-summary-card">
            <div class="summary-card-row">
              <span class="summary-label">Invoice Number</span>
              <span class="summary-val font-mono">${esc(inv.invoice_number)}</span>
            </div>
            ${inv.status === 'cancelled' ? `
            <div class="summary-card-row">
              <span class="summary-label">Status</span>
              <span class="summary-val" style="color:var(--danger-red)">Cancelled</span>
            </div>` : `
            <div class="summary-card-row">
              <span class="summary-label">Status</span>
              <span class="summary-val">${esc(inv.status)}</span>
            </div>`}
            ${customerName ? `
            <div class="summary-card-row">
              <span class="summary-label">Customer</span>
              <span class="summary-val">${esc(customerName)}</span>
            </div>` : ''}
            <div class="summary-card-row">
              <span class="summary-label">Total Value</span>
              <span class="summary-val highlight-total font-mono">${money(inv.total)}</span>
            </div>
          </div>
        </div>

        <div class="modern-confirm-footer">
          <button type="button" class="btn secondary" id="confirmCancelBtn">
            Cancel
          </button>
          <button type="button" class="btn danger" id="confirmDeleteBtn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px">
              <path d="M3 6h18"/>
              <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
            </svg>
            <span>Delete Permanently</span>
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    let resolved = false;
    const finish = (value) => {
      if (resolved) return;
      resolved = true;
      document.removeEventListener('keydown', handleKey);
      overlay.remove();
      resolve(value);
    };

    const handleKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      }
    };

    document.addEventListener('keydown', handleKey);

    const cancelBtn = overlay.querySelector('#confirmCancelBtn');
    const deleteBtn = overlay.querySelector('#confirmDeleteBtn');
    const closeBtn = overlay.querySelector('#confirmCloseBtn');

    if (cancelBtn) {
      cancelBtn.onclick = () => finish(false);
      cancelBtn.focus();
    }
    if (closeBtn) {
      closeBtn.onclick = () => finish(false);
    }
    if (deleteBtn) {
      deleteBtn.onclick = () => {
        deleteBtn.disabled = true;
        deleteBtn.innerHTML = `<span>Deleting...</span>`;
        finish(true);
      };
    }

    overlay.onclick = (e) => {
      if (e.target === overlay) finish(false);
    };
  });
}

function showCancelInvoiceModal(inv) {
  return new Promise(resolve => {
    const existing = document.getElementById('cancelInvoiceOverlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'modern-confirm-overlay';
    overlay.id = 'cancelInvoiceOverlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'cancelModalTitle');

    const customerName = inv.customers?.name || (inv.customer_id ? (state.customers?.find(c => c.id === inv.customer_id)?.name) : null);
    const isDraft = Boolean(inv.is_draft);

    overlay.innerHTML = `
      <div class="modern-confirm-modal">
        <div class="modern-confirm-body">
          <div class="confirm-modal-top">
            <div class="confirm-badge-icon warning">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
              </svg>
            </div>
            <button class="modal-close" id="cancelModalCloseBtn" type="button" aria-label="Close dialog">&times;</button>
          </div>

          <h3 class="confirm-modal-title" id="cancelModalTitle">${isDraft ? 'Cancel Draft Invoice' : 'Cancel Tax Invoice'}</h3>
          <p class="confirm-modal-prompt">
            Are you sure you want to cancel <span class="confirm-target-chip warning">${esc(inv.invoice_number)}</span>?
          </p>

          <div class="confirm-warning-banner warning">
            <div class="warning-banner-icon warning">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
                <line x1="12" y1="9" x2="12" y2="13"/>
                <line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
            </div>
            <div class="warning-banner-text warning">
              <strong>Invoice will be marked as CANCELLED.</strong>
              <span>${isDraft ? 'The draft status will update to cancelled. You can still delete this record permanently later.' : 'Official GST records will reflect cancellation and an audit entry will be logged.'}</span>
            </div>
          </div>

          <div class="confirm-summary-card">
            <div class="summary-card-row">
              <span class="summary-label">Invoice Number</span>
              <span class="summary-val font-mono">${esc(inv.invoice_number)}</span>
            </div>
            ${customerName ? `
            <div class="summary-card-row">
              <span class="summary-label">Customer</span>
              <span class="summary-val">${esc(customerName)}</span>
            </div>` : ''}
            <div class="summary-card-row">
              <span class="summary-label">Total Value</span>
              <span class="summary-val highlight-total font-mono">${money(inv.total)}</span>
            </div>
          </div>

          <div style="margin-top:14px">
            <label for="cancelReasonInput" style="display:block; font-size:12.5px; font-weight:600; color:var(--text-main); margin-bottom:6px">
              Cancellation Reason <span style="color:var(--danger-red)">*</span>
            </label>
            <textarea id="cancelReasonInput" rows="2" class="input" style="width:100%; resize:vertical; font-family:var(--font-body); font-size:13px; padding:8px 12px; border-radius:var(--radius-sm); border:1px solid var(--border-color); background:var(--bg-card); color:var(--text-main);" placeholder="e.g. Scope revised, duplicate draft, or client requested cancellation"></textarea>
            <div id="cancelReasonError" style="display:none; color:var(--danger-red); font-size:11.5px; margin-top:4px">Please provide a reason for cancellation.</div>
          </div>
        </div>

        <div class="modern-confirm-footer">
          <button type="button" class="btn secondary" id="cancelModalDismissBtn">
            Keep Invoice
          </button>
          <button type="button" class="btn warning-cancel" id="cancelModalConfirmBtn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px">
              <circle cx="12" cy="12" r="10"/>
              <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
            </svg>
            <span>Cancel Invoice</span>
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    let resolved = false;
    const finish = (value) => {
      if (resolved) return;
      resolved = true;
      document.removeEventListener('keydown', handleKey);
      overlay.remove();
      resolve(value);
    };

    const handleKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(null);
      }
    };

    document.addEventListener('keydown', handleKey);

    const dismissBtn = overlay.querySelector('#cancelModalDismissBtn');
    const confirmBtn = overlay.querySelector('#cancelModalConfirmBtn');
    const closeBtn = overlay.querySelector('#cancelModalCloseBtn');
    const reasonInput = overlay.querySelector('#cancelReasonInput');
    const reasonError = overlay.querySelector('#cancelReasonError');

    if (dismissBtn) dismissBtn.onclick = () => finish(null);
    if (closeBtn) closeBtn.onclick = () => finish(null);

    if (reasonInput) {
      setTimeout(() => reasonInput.focus(), 50);
      reasonInput.oninput = () => {
        if (reasonError) reasonError.style.display = 'none';
      };
      reasonInput.onkeydown = (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          confirmBtn.click();
        }
      };
    }

    if (confirmBtn) {
      confirmBtn.onclick = () => {
        const val = reasonInput ? reasonInput.value.trim() : '';
        if (!val) {
          if (reasonError) reasonError.style.display = 'block';
          if (reasonInput) reasonInput.focus();
          return;
        }
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = `<span>Cancelling...</span>`;
        finish(val);
      };
    }

    overlay.onclick = (e) => {
      if (e.target === overlay) finish(null);
    };
  });
}

function showEditPaymentModal(payment, inv) {
  return new Promise(resolve => {
    const existing = document.getElementById('editPaymentOverlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'modern-confirm-overlay';
    overlay.id = 'editPaymentOverlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    overlay.innerHTML = `
      <div class="modern-confirm-modal" style="max-width:540px">
        <div class="modern-confirm-body">
          <div class="confirm-modal-top">
            <div class="confirm-badge-icon" style="background:rgba(37,99,235,0.1);border-color:rgba(37,99,235,0.25);color:var(--primary);box-shadow:0 4px 12px rgba(37,99,235,0.12)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 20h9"/>
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
              </svg>
            </div>
            <button class="modal-close" id="editPayCloseBtn" type="button" aria-label="Close dialog">&times;</button>
          </div>

          <h3 class="confirm-modal-title">Edit Payment Receipt</h3>
          <p class="confirm-modal-prompt">
            Update receipt details for <span class="confirm-target-chip" style="color:var(--primary)">${esc(inv?.invoice_number || 'Invoice')}</span>
          </p>

          <form id="editPaymentForm" style="display:flex;flex-direction:column;gap:14px;margin-top:16px">
            <div class="row">
              <div class="field" style="flex:1">
                <label>Amount Received (₹) <span class="req">*</span></label>
                <input type="number" id="editPayAmount" name="amount" min="0.01" step="0.01" required value="${payment.amount}">
              </div>
              <div class="field" style="flex:1">
                <label>Payment Date <span class="req">*</span></label>
                <input type="date" id="editPayDate" name="payment_date" required value="${esc(payment.payment_date)}">
              </div>
            </div>

            <div class="row">
              <div class="field" style="flex:1">
                <label>Payment Mode <span class="req">*</span></label>
                <select id="editPayMethod" name="method">
                  <option value="Bank Transfer" ${payment.method === 'Bank Transfer' ? 'selected' : ''}>Bank Transfer (NEFT / RTGS / IMPS)</option>
                  <option value="UPI" ${payment.method === 'UPI' ? 'selected' : ''}>UPI</option>
                  <option value="Cheque" ${payment.method === 'Cheque' ? 'selected' : ''}>Cheque</option>
                  <option value="Cash" ${payment.method === 'Cash' ? 'selected' : ''}>Cash</option>
                  <option value="Other" ${payment.method === 'Other' ? 'selected' : ''}>Other</option>
                </select>
              </div>
              <div class="field" style="flex:1">
                <label>Reference / UTR</label>
                <input type="text" id="editPayRef" name="reference" value="${esc(payment.reference || '')}" placeholder="UTR / Bank ref" style="font-family:var(--font-mono)">
              </div>
            </div>

            <div class="field">
              <label>Internal Remarks</label>
              <input type="text" id="editPayRemarks" name="remarks" value="${esc(payment.remarks || '')}" placeholder="Optional notes regarding this receipt">
            </div>

            <div class="modern-confirm-footer" style="padding:16px 0 0 0;margin-top:8px">
              <button type="button" class="btn secondary" id="editPayCancelBtn">Cancel</button>
              <button type="submit" class="btn" id="editPaySubmitBtn">Save Changes</button>
            </div>
          </form>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const close = () => {
      overlay.classList.add('closing');
      setTimeout(() => { overlay.remove(); resolve(null); }, 180);
    };

    overlay.querySelector('#editPayCloseBtn').onclick = close;
    overlay.querySelector('#editPayCancelBtn').onclick = close;
    overlay.onclick = e => { if (e.target === overlay) close(); };

    overlay.querySelector('#editPaymentForm').onsubmit = async e => {
      e.preventDefault();
      const payload = {
        id: payment.id,
        amount: Number(overlay.querySelector('#editPayAmount').value),
        payment_date: overlay.querySelector('#editPayDate').value,
        method: overlay.querySelector('#editPayMethod').value,
        reference: overlay.querySelector('#editPayRef').value.trim(),
        remarks: overlay.querySelector('#editPayRemarks').value.trim()
      };

      const btn = overlay.querySelector('#editPaySubmitBtn');
      btn.disabled = true;

      try {
        let token = null;
        try {
          const session = await sb.auth.getSession();
          token = session?.data?.session?.access_token;
        } catch {}

        if (token && !state.mockMode) {
          const res = await fetch('/api/payments', {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(payload)
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Failed to update payment.');
        } else {
          const idx = state.payments.findIndex(p => p.id === payment.id);
          if (idx !== -1) Object.assign(state.payments[idx], payload);
          await sb.from('payments').update(payload).eq('id', payment.id);
        }

        toast('Payment record updated successfully', 'success');
        close();
        await loadData();
        render();
        resolve(payload);
      } catch (err) {
        toast('Error updating payment: ' + (err.message || String(err)), 'error');
        btn.disabled = false;
      }
    };
  });
}

function showDeletePaymentModal(payment, inv) {
  return new Promise(resolve => {
    const existing = document.getElementById('deletePaymentOverlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'modern-confirm-overlay';
    overlay.id = 'deletePaymentOverlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    overlay.innerHTML = `
      <div class="modern-confirm-modal">
        <div class="modern-confirm-body">
          <div class="confirm-modal-top">
            <div class="confirm-badge-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 6h18"/>
                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
                <line x1="10" x2="10" y1="11" y2="17"/>
                <line x1="14" x2="14" y1="11" y2="17"/>
              </svg>
            </div>
            <button class="modal-close" id="deletePayCloseBtn" type="button" aria-label="Close dialog">&times;</button>
          </div>

          <h3 class="confirm-modal-title">Delete Payment Permanently</h3>
          <p class="confirm-modal-prompt">
            Are you sure you want to permanently delete payment of <span class="confirm-target-chip">${money(payment.amount)}</span> for <span class="confirm-target-chip" style="color:var(--text-main)">${esc(inv?.invoice_number || 'Invoice')}</span>?
          </p>

          <div class="confirm-warning-banner">
            <div class="warning-banner-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
                <line x1="12" x2="12" y1="9" y2="13"/>
                <line x1="12" x2="12.01" y1="17" y2="17"/>
              </svg>
            </div>
            <div class="warning-banner-text">
              <strong>This action cannot be undone.</strong>
              <span>Deleting this payment will adjust the invoice balance and payment status accordingly.</span>
            </div>
          </div>

          <div class="confirm-summary-card">
            <div class="summary-card-row">
              <span class="summary-label">Invoice</span>
              <span class="summary-val font-mono">${esc(inv?.invoice_number || '—')}</span>
            </div>
            <div class="summary-card-row">
              <span class="summary-label">Payment Date</span>
              <span class="summary-val">${esc(payment.payment_date)}</span>
            </div>
            <div class="summary-card-row">
              <span class="summary-label">Payment Mode</span>
              <span class="summary-val">${esc(payment.method)}</span>
            </div>
            ${payment.reference ? `
            <div class="summary-card-row">
              <span class="summary-label">Reference</span>
              <span class="summary-val font-mono">${esc(payment.reference)}</span>
            </div>` : ''}
            <div class="summary-card-row">
              <span class="summary-label">Settled Amount</span>
              <span class="summary-val highlight-total font-mono">${money(payment.amount)}</span>
            </div>
          </div>
        </div>

        <div class="modern-confirm-footer">
          <button type="button" class="btn secondary" id="deletePayCancelBtn">Cancel</button>
          <button type="button" class="btn danger" id="deletePayConfirmBtn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px">
              <path d="M3 6h18"/>
              <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
            </svg>
            <span>Delete Permanently</span>
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const close = () => {
      overlay.classList.add('closing');
      setTimeout(() => { overlay.remove(); resolve(false); }, 180);
    };

    overlay.querySelector('#deletePayCloseBtn').onclick = close;
    overlay.querySelector('#deletePayCancelBtn').onclick = close;
    overlay.onclick = e => { if (e.target === overlay) close(); };

    overlay.querySelector('#deletePayConfirmBtn').onclick = async () => {
      const btn = overlay.querySelector('#deletePayConfirmBtn');
      btn.disabled = true;

      try {
        let token = null;
        try {
          const session = await sb.auth.getSession();
          token = session?.data?.session?.access_token;
        } catch {}

        if (token && !state.mockMode) {
          const res = await fetch('/api/payments', {
            method: 'DELETE',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ id: payment.id })
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Failed to delete payment.');
        } else {
          state.payments = state.payments.filter(p => p.id !== payment.id);
          await sb.from('payments').delete().eq('id', payment.id);
        }

        toast(`Payment of ${money(payment.amount)} deleted successfully`, 'info');
        close();
        await loadData();
        render();
        resolve(true);
      } catch (err) {
        toast('Error deleting payment: ' + (err.message || String(err)), 'error');
        btn.disabled = false;
      }
    };
  });
}

function showDeleteInviteModal(inv) {
  return new Promise(resolve => {
    const existing = document.getElementById('deleteInviteOverlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'modern-confirm-overlay';
    overlay.id = 'deleteInviteOverlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    overlay.innerHTML = `
      <div class="modern-confirm-modal">
        <div class="modern-confirm-body">
          <div class="confirm-modal-top">
            <div class="confirm-badge-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 6h18"/>
                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
                <line x1="10" x2="10" y1="11" y2="17"/>
                <line x1="14" x2="14" y1="11" y2="17"/>
              </svg>
            </div>
            <button class="modal-close" id="deleteInviteCloseBtn" type="button" aria-label="Close dialog">&times;</button>
          </div>

          <h3 class="confirm-modal-title">Delete Invitation</h3>
          <p class="confirm-modal-prompt">
            Are you sure you want to delete the invitation for <span class="confirm-target-chip">${esc(inv.email)}</span> permanently?
          </p>

          <div class="confirm-warning-banner">
            <div class="warning-banner-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
                <line x1="12" x2="12" y1="9" y2="13"/>
                <line x1="12" x2="12.01" y1="17" y2="17"/>
              </svg>
            </div>
            <div class="warning-banner-text">
              <strong>This action cannot be undone.</strong>
              <span>This invitation record will be removed permanently from the registry.</span>
            </div>
          </div>

          <div class="confirm-summary-card">
            <div class="summary-card-row">
              <span class="summary-label">Recipient Email</span>
              <span class="summary-val font-mono">${esc(inv.email)}</span>
            </div>
            <div class="summary-card-row">
              <span class="summary-label">Assigned Role</span>
              <span class="summary-val">${esc((inv.role || 'staff').toUpperCase())}</span>
            </div>
            <div class="summary-card-row">
              <span class="summary-label">Status</span>
              <span class="summary-val">${esc(inv.status || 'active')}</span>
            </div>
            ${inv.expires_at ? `
            <div class="summary-card-row">
              <span class="summary-label">Expires At</span>
              <span class="summary-val">${esc(formatDate(inv.expires_at))}</span>
            </div>` : ''}
          </div>
        </div>

        <div class="modern-confirm-footer">
          <button type="button" class="btn secondary" id="deleteInviteCancelBtn">Cancel</button>
          <button type="button" class="btn danger" id="deleteInviteConfirmBtn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px">
              <path d="M3 6h18"/>
              <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
            </svg>
            <span>Delete Permanently</span>
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const close = () => {
      overlay.classList.add('closing');
      setTimeout(() => { overlay.remove(); resolve(false); }, 180);
    };

    overlay.querySelector('#deleteInviteCloseBtn').onclick = close;
    overlay.querySelector('#deleteInviteCancelBtn').onclick = close;
    overlay.onclick = e => { if (e.target === overlay) close(); };

    overlay.querySelector('#deleteInviteConfirmBtn').onclick = () => {
      const btn = overlay.querySelector('#deleteInviteConfirmBtn');
      btn.disabled = true;
      btn.innerHTML = `<span>Deleting...</span>`;
      close();
      resolve(true);
    };
  });
}

function showInvoiceDetailsModal(inv) {
  const cust = state.customers.find(c => c.id === inv.customer_id) || (inv.customers || {});
  const s = state.settings || {};
  const payments = state.payments.filter(p => p.invoice_id === inv.id);
  const totalPaid = payments.filter(p => !p.is_reversed).reduce((acc, p) => acc + Number(p.amount), 0);
  const outstanding = Math.max(0, Number(inv.total) - totalPaid);

  const isIntrastate = inv.tax_type === 'CGST + SGST' || !inv.tax_type;
  const itemsList = inv.items?.length ? inv.items : [{
    description: inv.description || 'Professional Services for Management Consultancy',
    hsn_sac: inv.hsn_sac || '998312',
    amount: inv.subtotal
  }];

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal large" style="max-width:880px">
      <div class="modal-header">
        <div>
          <h2>${esc(invoiceHeading(inv))}: ${esc(inv.invoice_number)}</h2>
          <span class="tag ${inv.status}">${esc(inv.status)}</span>
        </div>
        <button class="modal-close" id="modalClose">&times;</button>
      </div>

      <div class="modal-body">
        <div class="invoice-view-tabs">
          <button type="button" class="tab-btn active" id="tabBtnPreview">📄 Official Tax Invoice Preview</button>
          <button type="button" class="tab-btn" id="tabBtnPayments">💳 Payment Ledger (${payments.length})</button>
        </div>

        <!-- TAB 1: OFFICIAL TAX INVOICE PREVIEW -->
        <div id="tabContentPreview" class="tax-invoice-wrapper">
          <div class="tax-invoice-sheet" id="invoiceSheetToPrint">
            ${(() => {
              const watermark = invoiceWatermark(inv);
              return watermark ? `<div class="inv-watermark${watermark === 'CANCELLED' ? ' inv-watermark-cancelled' : ''}" aria-hidden="true">${esc(watermark)}</div>` : '';
            })()}
            <!-- Header Block -->
            <div class="inv-header-block">
              <img src="/assets/logo.png" class="inv-header-logo" alt="MS Consulting Logo" onerror="this.style.display='none'">
              <div class="inv-issuer-name">${esc(s.issuer_name || 'MADHU M. S.')}</div>
              <div class="inv-issuer-address">
                SNO.125, 1ST FLOOR, 12TH CROSS 6TH MAIN, 3RD PHASE,<br>
                J.P.NAGAR, BANGALORE-560078, KARNATAKA
              </div>
              <div class="inv-issuer-contact">
                PHONE: ${esc(s.phone || '9964287173')} &nbsp;|&nbsp; EMAIL: ${esc(s.email || 'madhumsiddu@gmail.com')}
              </div>
            </div>

            <!-- Document Status Banner (DRAFT INVOICE / TAX INVOICE / — CANCELLED variants) -->
            <div class="inv-banner">${esc(invoiceHeading(inv))}</div>

            <!-- Bill To & Meta Grid -->
            <div class="inv-bill-meta-grid">
              <!-- Left: Customer -->
              <div class="inv-bill-to">
                <div class="inv-bill-to-label">To,</div>
                <div class="inv-cust-name">${esc(cust.name || 'CLIENT NAME')}</div>
                <div style="white-space:pre-line">${esc(cust.billing_address || '#810 , 5TH BLOCK , 100 FEET OUTER RING ROAD\nHOSKEREHALLI , BANASHANKARI 3RD STAGE')}</div>
                <div>${esc(cust.city || 'BANGALORE')}, ${esc(cust.state || 'KARNATAKA')}${cust.pin_code ? '-' + esc(cust.pin_code) : '-560085'}</div>
                <div style="font-weight:700;margin-top:6px">GSTIN NO: ${esc(cust.gstin || '—')}</div>
              </div>

              <!-- Right: Metadata Table -->
              <table class="inv-meta-table">
                <tr><td>Invoice No</td><td><strong>${esc(inv.invoice_number)}</strong></td></tr>
                <tr><td>Invoice Date</td><td>${esc(formatInvoiceDate(inv.invoice_date))}</td></tr>
                <tr><td>PAN</td><td>${esc(s.pan || 'APEPM7494M')}</td></tr>
                <tr><td>GSTIN NO</td><td>${esc(s.gstin || '29APEPM7494M1ZZ')}</td></tr>
                <tr><td>Place of Supply</td><td>${esc(inv.place_of_supply || 'Karnataka')}</td></tr>
                <tr><td>State Code</td><td>${esc(s.state_code || '29')}</td></tr>
              </table>
            </div>

            <!-- Line Items Table -->
            <table class="inv-items-grid">
              <thead>
                <tr>
                  <th style="width:58%;text-align:left">PARTICULARS</th>
                  <th style="width:18%;text-align:center">HSN/SAC</th>
                  <th style="width:24%;text-align:right">AMOUNT ( Rs. )</th>
                </tr>
              </thead>
              <tbody>
                <tr class="inv-items-main-row">
                  <td style="white-space:pre-line">
                    ${itemsList.map(it => esc(it.description)).join('\n\n')}
                  </td>
                  <td style="text-align:center">
                    ${itemsList.map(it => esc(it.hsn_sac || '998312')).join('<br>')}
                  </td>
                  <td style="text-align:right">
                    ${itemsList.map(it => money(it.amount).replace('₹', '')).join('<br>')}
                  </td>
                </tr>

                <!-- Summary Breakdown -->
                ${isIntrastate ? `
                  <tr class="inv-summary-row">
                    <td></td>
                    <td style="text-align:center">CGST @ ${inv.gst_rate ? inv.gst_rate / 2 : 9}%</td>
                    <td style="text-align:right">${money(inv.cgst || (inv.tax_amount / 2)).replace('₹', '')}</td>
                  </tr>
                  <tr class="inv-summary-row">
                    <td></td>
                    <td style="text-align:center">SGST @ ${inv.gst_rate ? inv.gst_rate / 2 : 9}%</td>
                    <td style="text-align:right">${money(inv.sgst || (inv.tax_amount / 2)).replace('₹', '')}</td>
                  </tr>
                ` : `
                  <tr class="inv-summary-row">
                    <td></td>
                    <td style="text-align:center">IGST @ ${inv.gst_rate || 18}%</td>
                    <td style="text-align:right">${money(inv.tax_amount).replace('₹', '')}</td>
                  </tr>
                `}

                <tr class="inv-total-row">
                  <td></td>
                  <td style="text-align:center">TOTAL</td>
                  <td style="text-align:right">${money(inv.total).replace('₹', '')}</td>
                </tr>
              </tbody>
            </table>

            <!-- Words Banner -->
            <div class="inv-words-bar">
              ${esc(inv.amount_in_words || amountInWords(inv.total))}
            </div>

            <!-- Bottom Section: Bank and Signature -->
            <div class="inv-bottom-grid">
              <!-- Left: Bank Details -->
              <div class="inv-bank-box">
                <table class="inv-bank-table">
                  <tr><td>Bank Name:</td><td>${esc(s.bank_name || 'STATE BANK OF INDIA')}</td></tr>
                  <tr><td>Bank Address:</td><td>${esc(s.branch || 'JP NAGAR 1ST PHASE\nBANGALORE KARNATAKA - 560078')}</td></tr>
                  <tr><td>SBI Bank A/c Name:</td><td>${esc(s.account_name || 'MADHU M S')}</td></tr>
                  <tr><td>SBI BANK A/C NO.:</td><td>${esc(s.account_number || '20300723746')}</td></tr>
                  <tr><td>RTGS/NEFT/IFSC:</td><td>${esc(s.ifsc || 'SBIN0007117')}</td></tr>
                </table>
              </div>

              <!-- Right: Signature -->
              <div class="inv-sig-box">
                <div class="inv-sig-title">For ${esc(s.issuer_name || 'MADHU M. S.')}</div>
                <img src="/assets/signature.png" class="inv-sig-img" alt="MADHU M. S. Signature" onerror="this.style.display='none'">
                <div class="inv-sig-label">AUTHORISED SIGNATORY</div>
              </div>
            </div>
          </div>
        </div>

        <!-- TAB 2: PAYMENT HISTORY & RECORDING -->
        <div id="tabContentPayments" style="display:none;margin-top:16px">
          <div class="calc-box">
            <div>
              <div class="calc-title">Taxable: ${money(inv.subtotal)} | ${esc(inv.tax_type)}: ${money(inv.tax_amount)}</div>
              <div class="calc-total">Total: ${money(inv.total)}</div>
            </div>
            <div style="text-align:right">
              <div style="font-size:13px;color:var(--success-green);font-weight:700">Paid: ${money(totalPaid)}</div>
              <div style="font-size:15px;color:var(--warning-amber);font-weight:800">Outstanding: ${money(outstanding)}</div>
            </div>
            <div class="calc-words">${esc(inv.amount_in_words)}</div>
          </div>

          <h4 style="margin:16px 0 8px">Payment Transactions</h4>
          ${payments.length ? `
            <div class="table-container">
              <table>
                <thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>UTR / Reference</th><th>Status</th>${state.role === 'admin' ? '<th style="text-align:right">Action</th>' : ''}</tr></thead>
                <tbody>
                  ${payments.map(p => `
                    <tr>
                      <td>${esc(p.payment_date)}</td>
                      <td><strong>${money(p.amount)}</strong></td>
                      <td>${esc(p.method)}</td>
                      <td>${esc(p.reference || '—')}</td>
                      <td>${p.is_reversed ? '<span class="tag cancelled">Reversed</span>' : '<span class="tag paid">Settled</span>'}</td>
                      ${state.role === 'admin' ? `
                        <td style="text-align:right">
                          ${!p.is_reversed ? `<button type="button" class="btn secondary small btn-rev-pay" data-payid="${p.id}" style="color:var(--danger-red);padding:3px 8px;font-size:11px">Reverse</button>` : '—'}
                        </td>
                      ` : ''}
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          ` : '<p class="muted" style="font-size:13px">No payments recorded against this invoice yet.</p>'}
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn primary" id="modalPrintPdfBtn">📥 Download Official PDF</button>
        <button class="btn secondary" id="modalBrowserPrintBtn">🖨️ Print Invoice</button>
        ${outstanding > 0 && inv.status !== 'cancelled' && inv.is_draft !== true ? `<button class="btn secondary" id="modalPayBtn">💳 Record Payment</button>` : ''}
        <button class="btn" id="modalCloseBtn">Close</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const close = () => modal.remove();
  modal.querySelector('#modalClose').onclick = close;
  modal.querySelector('#modalCloseBtn').onclick = close;
  modal.querySelector('#modalPrintPdfBtn').onclick = () => generateInvoicePDF(inv);
  modal.querySelector('#modalBrowserPrintBtn').onclick = () => window.print();

  if (modal.querySelector('#modalPayBtn')) {
    modal.querySelector('#modalPayBtn').onclick = () => {
      close();
      showRecordPaymentModal(inv);
    };
  }

  // Tab switching
  const tabBtnPreview = modal.querySelector('#tabBtnPreview');
  const tabBtnPayments = modal.querySelector('#tabBtnPayments');
  const contentPreview = modal.querySelector('#tabContentPreview');
  const contentPayments = modal.querySelector('#tabContentPayments');

  tabBtnPreview.onclick = () => {
    tabBtnPreview.classList.add('active');
    tabBtnPayments.classList.remove('active');
    contentPreview.style.display = 'flex';
    contentPayments.style.display = 'none';
  };

  tabBtnPayments.onclick = () => {
    tabBtnPayments.classList.add('active');
    tabBtnPreview.classList.remove('active');
    contentPreview.style.display = 'none';
    contentPayments.style.display = 'block';
  };

  modal.querySelectorAll('.btn-rev-pay').forEach(btn => {
    btn.onclick = async () => {
      const payId = btn.dataset.payid;
      const reason = prompt('Please enter the reason for reversing this payment:');
      if (!reason || !reason.trim()) return;

      try {
        const { error: rpcErr } = await sb.rpc('reverse_invoice_payment', {
          p_payment_id: payId,
          p_reason: reason.trim()
        });
        if (rpcErr) throw rpcErr;

        toast('Payment reversed successfully', 'success');
        modal.remove();
        await loadData();
        render();
      } catch (err) {
        alert('Error reversing payment: ' + (err.message || String(err)));
      }
    };
  });
}

// ============================================================================
// 4. CUSTOMER MASTER
// ============================================================================
function customers() {
  const isEditing = Boolean(state.editingCustomer);
  const cust = state.editingCustomer;

  const content = `
    <div class="panel">
      <h3>${isEditing ? 'Edit Customer Record' : 'Add New Customer'}</h3>
      <form id="customerForm">
        <div class="row">
          <div class="field" style="flex:2">
            <label>Customer / Company Name <span class="req">*</span></label>
            <input type="text" name="name" value="${esc(cust?.name || '')}" required placeholder="e.g. Acme Solutions Pvt Ltd">
          </div>
          <div class="field">
            <label>Contact Person</label>
            <input type="text" name="contact_person" value="${esc(cust?.contact_person || '')}" placeholder="Key Contact Name">
          </div>
        </div>

        <div class="row">
          <div class="field">
            <label>Email Address</label>
            <input type="email" name="email" value="${esc(cust?.email || '')}" placeholder="billing@client.com">
          </div>
          <div class="field">
            <label>Phone / Mobile</label>
            <input type="text" name="phone" value="${esc(cust?.phone || '')}" placeholder="+91 98765 43210">
          </div>
          <div class="field">
            <label>GSTIN (15 Digits)</label>
            <input type="text" name="gstin" id="custGstin" value="${esc(cust?.gstin || '')}" placeholder="29AABCA1234A1Z5" style="font-family:var(--font-mono)">
          </div>
          <div class="field">
            <label>PAN (10 Digits)</label>
            <input type="text" name="pan" id="custPan" value="${esc(cust?.pan || '')}" placeholder="AABCA1234A" style="font-family:var(--font-mono)">
          </div>
        </div>

        <div class="field">
          <label>Registered Billing Address</label>
          <input type="text" name="billing_address" value="${esc(cust?.billing_address || '')}" placeholder="Door, Street, Industrial Area">
        </div>

        <div class="row">
          <div class="field">
            <label>City</label>
            <input type="text" name="city" value="${esc(cust?.city || 'Bangalore')}">
          </div>
          <div class="field">
            <label>State & State Code <span class="req">*</span></label>
            <select name="state_code" id="stateSelect" required>
              ${INDIAN_STATES.map(s => `<option value="${s.code}" ${cust?.state_code === s.code || (!cust && s.code === '29') ? 'selected' : ''}>${s.name} (${s.code})</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label>PIN Code</label>
            <input type="text" name="pin_code" value="${esc(cust?.pin_code || '')}" placeholder="560001">
          </div>
        </div>

        <div class="field">
          <label>Internal Client Notes</label>
          <input type="text" name="notes" value="${esc(cust?.notes || '')}" placeholder="e.g. Terms, specialized retainer agreements">
        </div>

        <div class="row" style="justify-content:flex-end">
          ${isEditing ? `<button type="button" class="btn secondary" id="cancelCustEdit">Cancel</button>` : ''}
          <button type="submit" class="btn">${isEditing ? 'Update Customer' : 'Save Customer'}</button>
        </div>
      </form>
    </div>

    <div class="panel">
      <div class="row between" style="margin-bottom:16px">
        <h3>Customer Master Directory</h3>
        <input type="text" id="custSearch" placeholder="Search by name, GSTIN, city..." style="max-width:280px">
      </div>
      <div id="custList"></div>
    </div>
  `;

  layout(content, 'Customer Master');

  if ($('#cancelCustEdit')) {
    $('#cancelCustEdit').onclick = () => {
      state.editingCustomer = null;
      customers();
    };
  }

  // Auto-fill PAN from GSTIN if 15 chars
  $('#custGstin').oninput = e => {
    const val = e.target.value.trim().toUpperCase();
    e.target.value = val;
    if (val.length === 15) {
      const extractedPan = val.slice(2, 12);
      $('#custPan').value = extractedPan;
      const stateCode = val.slice(0, 2);
      if ($(`#stateSelect option[value="${stateCode}"]`)) {
        $('#stateSelect').value = stateCode;
      }
    }
  };

  const showList = () => {
    const q = $('#custSearch').value.toLowerCase();
    const filtered = state.customers.filter(c =>
      c.name.toLowerCase().includes(q) ||
      (c.gstin && c.gstin.toLowerCase().includes(q)) ||
      (c.city && c.city.toLowerCase().includes(q))
    );

    if (!filtered.length) {
      $('#custList').innerHTML = `<div class="empty">No customers found.</div>`;
      return;
    }

    $('#custList').innerHTML = `
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Customer Name</th>
              <th>GSTIN / PAN</th>
              <th>Location</th>
              <th>Contact Details</th>
              <th>Billed Value</th>
              <th>Cancelled</th>
              <th style="text-align:right">Action</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.map(c => {
              const custInvoices = state.invoices.filter(i => i.customer_id === c.id);
              const activeInvoices = custInvoices.filter(i => i.status !== 'cancelled');
              const cancelledInvoices = custInvoices.filter(i => i.status === 'cancelled');
              const billed = activeInvoices.reduce((acc, i) => acc + Number(i.total), 0);
              const cancelledTotal = cancelledInvoices.reduce((acc, i) => acc + Number(i.total), 0);
              return `
                <tr>
                  <td><strong>${esc(c.name)}</strong></td>
                  <td>
                    <div style="font-family:var(--font-mono);font-size:12px">${esc(c.gstin || 'No GSTIN')}</div>
                    <small class="muted">${esc(c.pan || '')}</small>
                  </td>
                  <td>${esc(c.city || '')}, ${esc(c.state || 'Karnataka')}</td>
                  <td>
                    <div>${esc(c.contact_person || '—')}</div>
                    <small class="muted">${esc(c.email || c.phone || '')}</small>
                  </td>
                  <td><strong>${money(billed)}</strong></td>
                  <td>
                    ${cancelledInvoices.length
                      ? `<span class="tag cancelled">${cancelledInvoices.length} cancelled</span> <small class="muted" style="color:var(--danger-red)">${money(cancelledTotal)}</small>`
                      : '<span class="muted">—</span>'}
                  </td>
                  <td>
                    <div class="actions">
                      <button class="btn secondary small" data-editcust="${c.id}">Edit</button>
                      ${state.role === 'admin' ? `<button class="btn danger small" data-delcust="${c.id}" title="Delete Customer">Delete</button>` : ''}
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;

    document.querySelectorAll('[data-editcust]').forEach(b => {
      b.onclick = () => {
        state.editingCustomer = state.customers.find(c => c.id === b.dataset.editcust);
        customers();
      };
    });
    document.querySelectorAll('[data-delcust]').forEach(b => {
      b.onclick = async () => {
        const target = state.customers.find(c => c.id === b.dataset.delcust);
        if (!target) return;

        // DB enforces ON DELETE RESTRICT on invoices.customer_id
        const linkedInvoices = state.invoices.filter(i => i.customer_id === target.id);
        if (linkedInvoices.length) {
          toast(`Cannot delete "${target.name}" — ${linkedInvoices.length} invoice(s) are already linked to this customer. Delete those invoices first.`, 'error');
          return;
        }

        const confirmed = await new Promise(resolve => {
          const overlay = document.createElement('div');
          overlay.className = 'modal-overlay';
          overlay.innerHTML = `
            <div class="modal large" style="max-width:480px">
              <div class="modal-header">
                <div class="modal-title">
                  <h2>Delete Customer</h2>
                  <p class="muted small" style="margin-top:6px">Permanently delete <strong>${esc(target.name)}</strong></p>
                </div>
                <button class="modal-close" id="modalClose">&times;</button>
              </div>
              <div class="modal-body">
                <p class="muted" style="margin-bottom:12px">This action cannot be undone. All records linked to this customer will be removed.</p>
              </div>
              <div class="modal-footer">
                <button type="button" class="btn secondary" id="modalCancel">Cancel</button>
                <button type="button" class="btn danger" id="modalDelete">Delete Permanently</button>
              </div>
            </div>
          `;
          document.body.appendChild(overlay);

          const close = () => overlay.remove();
          overlay.querySelector('#modalClose').onclick = close;
          overlay.querySelector('#modalCancel').onclick = close;
          overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close();
          });

          overlay.querySelector('#modalDelete').onclick = () => {
            close();
            resolve(true);
          };
        });

        if (!confirmed) return;

        b.disabled = true;
        try {
          const { error } = await sb.from('customers').delete().eq('id', target.id);
          if (error) throw error;
          if (state.editingCustomer && state.editingCustomer.id === target.id) {
            state.editingCustomer = null;
          }
          toast(`Customer "${target.name}" deleted successfully`, 'success');
          await loadData();
          customers();
        } catch (err) {
          b.disabled = false;
          const isPermissionError = /permission denied/i.test(String(err.message || err));
          if (isPermissionError) {
            toast('⚠️ Permission denied. You do not have permission to delete customers. Please contact your administrator.', 'error');
          } else {
            toast('⚠️ Error deleting customer: ' + (err.message || String(err)), 'error');
          }
        }
      };
    });

  };

  $('#custSearch').oninput = showList;
  showList();

  $('#customerForm').onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const stateCode = fd.get('state_code');
    const stateObj = INDIAN_STATES.find(s => s.code === stateCode);

    const payload = {
      name: fd.get('name')?.trim(),
      contact_person: fd.get('contact_person')?.trim(),
      email: fd.get('email')?.trim(),
      phone: fd.get('phone')?.trim(),
      gstin: fd.get('gstin')?.trim().toUpperCase(),
      pan: fd.get('pan')?.trim().toUpperCase(),
      billing_address: fd.get('billing_address')?.trim(),
      city: fd.get('city')?.trim(),
      state: stateObj?.name || 'Karnataka',
      state_code: stateCode,
      pin_code: fd.get('pin_code')?.trim(),
      notes: fd.get('notes')?.trim()
    };

    try {
      if (isEditing) {
        const { error } = await sb.from('customers').update(payload).eq('id', cust.id);
        if (error) throw error;
        toast('Customer record updated successfully', 'success');
      } else {
        const { error } = await sb.from('customers').insert(payload);
        if (error) throw error;
        toast('New customer created successfully', 'success');
      }
      state.editingCustomer = null;
      await loadData();
      customers();
    } catch (err) {
      alert('Error saving customer: ' + (err.message || String(err)));
    }
  };
}

// ============================================================================
// 5. PAYMENT TRACKING
// ============================================================================
function payments() {
  const content = `
    <div class="panel">
      <h3>Record Payment Receipt</h3>
      <form id="payRecordForm">
        <div class="row">
          <div class="field" style="flex:2">
            <label>Target Invoice <span class="req">*</span></label>
            <select name="invoice_id" id="payInvSelect" required>
              <option value="">-- Choose Invoice to Settle --</option>
              ${state.invoices.filter(i => i.status !== 'cancelled' && i.status !== 'paid').map(i => {
                const paid = state.payments.filter(p => p.invoice_id === i.id).reduce((acc, p) => acc + Number(p.amount), 0);
                const outstanding = Math.max(0, Number(i.total) - paid);
                return `<option value="${i.id}" data-out="${outstanding}">${esc(i.invoice_number)} • ${esc(i.customers?.name || 'Client')} • Total ${money(i.total)} (Bal: ${money(outstanding)})</option>`;
              }).join('')}
            </select>
          </div>
          <div class="field">
            <label>Amount Received (₹) <span class="req">*</span></label>
            <input type="number" name="amount" id="payAmountInput" min="0.01" step="0.01" required placeholder="0.00">
          </div>
          <div class="field">
            <label>Payment Date <span class="req">*</span></label>
            <input type="date" name="payment_date" value="${new Date().toISOString().slice(0, 10)}" required>
          </div>
        </div>

        <div class="row">
          <div class="field">
            <label>Payment Mode <span class="req">*</span></label>
            <select name="method">
              <option value="Bank Transfer">Bank Transfer (NEFT / RTGS / IMPS)</option>
              <option value="UPI">UPI</option>
              <option value="Cheque">Cheque</option>
              <option value="Cash">Cash</option>
              <option value="Other">Other</option>
            </select>
          </div>
          <div class="field" style="flex:2">
            <label>Bank Reference / UTR Number</label>
            <input type="text" name="reference" placeholder="e.g. UTR / NEFT reference number" style="font-family:var(--font-mono)">
          </div>
          <div class="field" style="flex:2">
            <label>Internal Remarks</label>
            <input type="text" name="remarks" placeholder="Optional notes regarding this receipt">
          </div>
        </div>

        <div class="row" style="justify-content:flex-end;margin-top:10px">
          <button type="submit" class="btn">Record Payment</button>
        </div>
      </form>
    </div>

    <div class="panel">
      <div class="row between" style="margin-bottom:16px">
        <h3>Payment Collections Register</h3>
        <input type="text" id="paySearch" placeholder="Search by reference, invoice, client..." style="max-width:280px">
      </div>
      <div id="paymentsListContainer"></div>
    </div>
  `;

  layout(content, 'Payment Tracking');

  $('#payInvSelect').onchange = e => {
    const opt = e.target.selectedOptions[0];
    if (opt?.dataset?.out) {
      $('#payAmountInput').value = opt.dataset.out;
    }
  };

  const showPayments = () => {
    const q = $('#paySearch').value.toLowerCase();
    const filtered = state.payments.filter(p => {
      const inv = state.invoices.find(i => i.id === p.invoice_id);
      return (p.reference && p.reference.toLowerCase().includes(q)) ||
             (inv?.invoice_number && inv.invoice_number.toLowerCase().includes(q)) ||
             (inv?.customers?.name && inv.customers.name.toLowerCase().includes(q));
    });

    if (!filtered.length) {
      $('#paymentsListContainer').innerHTML = `<div class="empty">No payments matching your query.</div>`;
      return;
    }

    $('#paymentsListContainer').innerHTML = `
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Receipt Date</th>
              <th>Invoice Number</th>
              <th>Customer</th>
              <th>Payment Mode</th>
              <th>Reference / UTR</th>
              <th>Amount Settled</th>
              ${state.role === 'admin' ? '<th style="text-align:right">Actions</th>' : ''}
            </tr>
          </thead>
          <tbody>
            ${filtered.map(p => {
              const inv = state.invoices.find(i => i.id === p.invoice_id);
              return `
                <tr>
                  <td>${esc(p.payment_date)}</td>
                  <td><strong>${esc(inv?.invoice_number || '—')}</strong></td>
                  <td>${esc(inv?.customers?.name || '—')}</td>
                  <td>${esc(p.method)}</td>
                  <td><code style="font-family:var(--font-mono);font-size:12px">${esc(p.reference || '—')}</code></td>
                  <td><strong style="color:var(--success-green)">${money(p.amount)}</strong></td>
                  ${state.role === 'admin' ? `
                    <td style="text-align:right">
                      <div class="actions" style="justify-content:flex-end">
                        <button class="btn secondary small btn-edit-payment" data-editpay="${p.id}" title="Edit Payment">Edit</button>
                        <button class="btn secondary small btn-delete-payment" data-delpay="${p.id}" style="color:var(--danger-red)" title="Delete Payment">Delete</button>
                      </div>
                    </td>
                  ` : ''}
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;

    document.querySelectorAll('[data-editpay]').forEach(btn => {
      btn.onclick = () => {
        const p = state.payments.find(x => x.id === btn.dataset.editpay);
        if (!p) return;
        const inv = state.invoices.find(i => i.id === p.invoice_id);
        showEditPaymentModal(p, inv);
      };
    });

    document.querySelectorAll('[data-delpay]').forEach(btn => {
      btn.onclick = () => {
        const p = state.payments.find(x => x.id === btn.dataset.delpay);
        if (!p) return;
        const inv = state.invoices.find(i => i.id === p.invoice_id);
        showDeletePaymentModal(p, inv);
      };
    });
  };

  $('#paySearch').oninput = showPayments;
  showPayments();

  $('#payRecordForm').onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const invId = fd.get('invoice_id');
    const amount = Number(fd.get('amount'));

    if (!invId || amount <= 0) {
      alert('Please select an invoice and enter a valid positive payment amount.');
      return;
    }

    try {
      // First attempt concurrency-safe atomic RPC
      const rpcRes = await sb.rpc('record_invoice_payment', {
        p_invoice_id: invId,
        p_amount: amount,
        p_payment_date: fd.get('payment_date'),
        p_method: fd.get('method'),
        p_reference: fd.get('reference')?.trim() || '',
        p_remarks: fd.get('remarks')?.trim() || ''
      });
      if (rpcRes.error) throw rpcRes.error;

      toast('Payment successfully recorded and invoice status updated', 'success');
      await loadData();
      payments();
    } catch (err) {
      alert('Error recording payment: ' + (err.message || String(err)));
    }
  };
}

function showRecordPaymentModal(inv) {
  const paid = state.payments.filter(p => p.invoice_id === inv.id).reduce((acc, p) => acc + Number(p.amount), 0);
  const outstanding = Math.max(0, Number(inv.total) - paid);

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h2>Record Payment: ${esc(inv.invoice_number)}</h2>
        <button class="modal-close" id="modalClosePay">&times;</button>
      </div>
      <form id="modalPayForm">
        <div class="modal-body">
          <div class="notice" style="margin-bottom:14px">
            Invoice Total: <strong>${money(inv.total)}</strong> | Current Outstanding: <strong style="color:var(--warning-amber)">${money(outstanding)}</strong>
          </div>
          <div class="field">
            <label>Amount Received (₹) <span class="req">*</span></label>
            <input type="number" name="amount" value="${outstanding}" min="0.01" max="${outstanding + 1}" step="0.01" required>
          </div>
          <div class="field">
            <label>Payment Date <span class="req">*</span></label>
            <input type="date" name="payment_date" value="${new Date().toISOString().slice(0, 10)}" required>
          </div>
          <div class="field">
            <label>Payment Mode <span class="req">*</span></label>
            <select name="method">
              <option value="Bank Transfer">Bank Transfer (NEFT / RTGS)</option>
              <option value="UPI">UPI</option>
              <option value="Cheque">Cheque</option>
              <option value="Cash">Cash</option>
            </select>
          </div>
          <div class="field">
            <label>Reference / UTR</label>
            <input type="text" name="reference" placeholder="UTR Reference Number">
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn secondary" id="modalPayCancel">Cancel</button>
          <button type="submit" class="btn">Record Receipt</button>
        </div>
      </form>
    </div>
  `;

  document.body.appendChild(modal);

  const close = () => modal.remove();
  modal.querySelector('#modalClosePay').onclick = close;
  modal.querySelector('#modalPayCancel').onclick = close;

  modal.querySelector('#modalPayForm').onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const amount = Number(fd.get('amount'));

    try {
      const rpcRes = await sb.rpc('record_invoice_payment', {
        p_invoice_id: inv.id,
        p_amount: amount,
        p_payment_date: fd.get('payment_date'),
        p_method: fd.get('method'),
        p_reference: fd.get('reference')?.trim() || '',
        p_remarks: ''
      });
      if (rpcRes.error) throw rpcRes.error;

      toast('Payment recorded successfully', 'success');
      close();
      await loadData();
      render();
    } catch (err) {
      alert('Error recording payment: ' + (err.message || String(err)));
    }
  };
}

// ============================================================================
// 6. REPORTS & ANALYTICS
// ============================================================================
function reports() {
  const currentTab = state.reportsTab || 'monthly';

  const content = `
    <div class="panel">
      <div class="tab-bar">
        <button class="tab-btn ${currentTab === 'monthly' ? 'active' : ''}" data-tab="monthly">Monthly Billing Report</button>
        <button class="tab-btn ${currentTab === 'customers' ? 'active' : ''}" data-tab="customers">Customer-wise Revenue</button>
        <button class="tab-btn ${currentTab === 'outstanding' ? 'active' : ''}" data-tab="outstanding">Outstanding Receivables</button>
        <button class="tab-btn ${currentTab === 'gst' ? 'active' : ''}" data-tab="gst">GST Tax Summary</button>
      </div>

      <div class="row between" style="margin-bottom:20px">
        <div class="row">
          <select id="reportFYSelect" style="max-width:180px">
            <option value="">All Financial Years</option>
            <option value="2026-27" selected>FY 2026-27</option>
            <option value="2025-26">FY 2025-26</option>
          </select>
        </div>
        <div class="row">
          <button class="btn secondary" id="exportCsvBtn">📥 Export CSV</button>
          <button class="btn secondary" id="printReportBtn">🖨️ Print Report</button>
        </div>
      </div>

      <div id="reportContainer"></div>
    </div>
  `;

  layout(content, 'Financial Reports & Tax Analytics');

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.onclick = () => {
      state.reportsTab = btn.dataset.tab;
      reports();
    };
  });

  const renderCurrentReport = () => {
    const fy = $('#reportFYSelect').value;
    const invs = state.invoices.filter(i => (!fy || i.financial_year === fy) && i.status !== 'cancelled');

    if (currentTab === 'monthly') {
      const monthMap = {};
      invs.forEach(i => {
        const m = i.invoice_date?.slice(0, 7) || 'Unknown';
        if (!monthMap[m]) monthMap[m] = { count: 0, taxable: 0, tax: 0, total: 0 };
        monthMap[m].count++;
        monthMap[m].taxable += Number(i.subtotal || 0);
        monthMap[m].tax += Number(i.tax_amount || 0);
        monthMap[m].total += Number(i.total || 0);
      });

      const rows = Object.keys(monthMap).sort().reverse().map(m => `
        <tr>
          <td><strong>${m}</strong></td>
          <td>${monthMap[m].count}</td>
          <td>${money(monthMap[m].taxable)}</td>
          <td>${money(monthMap[m].tax)}</td>
          <td><strong>${money(monthMap[m].total)}</strong></td>
        </tr>
      `).join('');

      $('#reportContainer').innerHTML = `
        <div class="table-container">
          <table>
            <thead><tr><th>Month</th><th>Invoices</th><th>Taxable Value</th><th>GST Amount</th><th>Total Billed</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="5" class="empty">No data for selected period</td></tr>'}</tbody>
          </table>
        </div>
      `;
    } else if (currentTab === 'customers') {
      const custRows = state.customers.map(c => {
        const cInvs = invs.filter(i => i.customer_id === c.id);
        const billed = cInvs.reduce((acc, i) => acc + Number(i.total), 0);
        const paid = state.payments.filter(p => cInvs.some(i => i.id === p.invoice_id)).reduce((acc, p) => acc + Number(p.amount), 0);
        const outstanding = Math.max(0, billed - paid);
        return { name: c.name, count: cInvs.length, billed, paid, outstanding };
      }).filter(r => r.billed > 0);

      $('#reportContainer').innerHTML = `
        <div class="table-container">
          <table>
            <thead><tr><th>Customer Name</th><th>Invoices</th><th>Total Invoiced</th><th>Total Collected</th><th>Outstanding Balance</th></tr></thead>
            <tbody>
              ${custRows.map(r => `
                <tr>
                  <td><strong>${esc(r.name)}</strong></td>
                  <td>${r.count}</td>
                  <td>${money(r.billed)}</td>
                  <td style="color:var(--success-green)">${money(r.paid)}</td>
                  <td style="color:var(--warning-amber)"><strong>${money(r.outstanding)}</strong></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    } else if (currentTab === 'outstanding') {
      const outInvs = invs.filter(i => i.status === 'unpaid' || i.status === 'partial');
      $('#reportContainer').innerHTML = `
        <div class="table-container">
          <table>
            <thead><tr><th>Invoice No</th><th>Customer</th><th>Date</th><th>Due Date</th><th>Total</th><th>Outstanding</th></tr></thead>
            <tbody>
              ${outInvs.map(i => {
                const paid = state.payments.filter(p => p.invoice_id === i.id).reduce((acc, p) => acc + Number(p.amount), 0);
                const bal = Number(i.total) - paid;
                return `
                  <tr>
                    <td><strong>${esc(i.invoice_number)}</strong></td>
                    <td>${esc(i.customers?.name || '—')}</td>
                    <td>${esc(i.invoice_date)}</td>
                    <td>${esc(i.due_date || '—')}</td>
                    <td>${money(i.total)}</td>
                    <td style="color:var(--danger-red)"><strong>${money(bal)}</strong></td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `;
    } else if (currentTab === 'gst') {
      const cgst = invs.reduce((acc, i) => acc + Number(i.cgst || 0), 0);
      const sgst = invs.reduce((acc, i) => acc + Number(i.sgst || 0), 0);
      const igst = invs.reduce((acc, i) => acc + Number(i.igst || 0), 0);
      const totalTax = cgst + sgst + igst;
      const taxable = invs.reduce((acc, i) => acc + Number(i.subtotal || 0), 0);

      $('#reportContainer').innerHTML = `
        <div class="cards">
          <div class="card"><div class="label">Taxable Value</div><div class="metric">${money(taxable)}</div></div>
          <div class="card"><div class="label">CGST (Intrastate)</div><div class="metric" style="color:var(--primary-blue)">${money(cgst)}</div></div>
          <div class="card"><div class="label">SGST (Intrastate)</div><div class="metric" style="color:var(--primary-blue)">${money(sgst)}</div></div>
          <div class="card"><div class="label">IGST (Interstate)</div><div class="metric" style="color:var(--gold-accent)">${money(igst)}</div></div>
        </div>
        <div class="panel" style="margin-top:20px">
          <h3>Total GST Payable: <span style="color:var(--primary-blue)">${money(totalTax)}</span></h3>
          <p class="muted">All figures generated directly from finalized invoices in the database.</p>
        </div>
      `;
    }
  };

  $('#reportFYSelect').onchange = renderCurrentReport;
  renderCurrentReport();

  $('#exportCsvBtn').onclick = () => {
    const csvContent = "data:text/csv;charset=utf-8," + "Invoice No,Customer,Date,Total,Status\n" +
      state.invoices.map(i => `"${i.invoice_number}","${i.customers?.name || ''}","${i.invoice_date}",${i.total},"${i.status}"`).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `billing_report_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  $('#printReportBtn').onclick = () => window.print();
}

// ============================================================================
// 7. ENTERPRISE ADMIN CONTROL CENTER (Admin Only — Governance, RBAC & Audit)
// ============================================================================

async function getAuthToken() {
  if (state.sessionToken) return state.sessionToken;
  try {
    const res = await sb?.auth?.getSession();
    const tok = res?.data?.session?.access_token;
    if (tok) state.sessionToken = tok;
    return tok;
  } catch {
    return null;
  }
}

async function fetchAdminData(force = false) {
  if (state.adminLoading && !force) return;
  state.adminLoading = true;
  try {
    const token = await getAuthToken();
    if (!token) return;
    const authHeaders = { 'Authorization': `Bearer ${token}` };

    const promises = [
      fetch('/api/users', { headers: authHeaders }).then(r => r.ok ? r.json() : null),
      fetch('/api/invite', { headers: authHeaders }).then(r => r.ok ? r.json() : null)
    ];
    if (state.adminTab === 'activity') {
      let auditUrl = '/api/audit?limit=50';
      if (state.adminActivityFilter) {
        auditUrl += `&action=${encodeURIComponent(state.adminActivityFilter)}`;
      }
      promises.push(fetch(auditUrl, { headers: authHeaders }).then(r => r.ok ? r.json() : null));
    }

    const [usersPayload, invitesPayload, auditPayload] = await Promise.all(promises);

    if (usersPayload?.users) {
      state.adminUsersList = usersPayload.users;
      state.adminMetrics = usersPayload.metrics || state.adminMetrics;
    }
    if (invitesPayload?.invites) {
      state.adminInvitesList = invitesPayload.invites;
    }
    if (auditPayload?.logs) {
      state.adminActivityLogs = auditPayload.logs;
    }
    state.adminLastFetched = Date.now();

    if (state.page === 'User Management') {
      renderAdminControlCenterView();
    }
  } catch (err) {
    console.warn('Background admin data sync warning:', err);
  } finally {
    state.adminLoading = false;
  }
}

function userManagement(forceRefresh = false) {
  if (state.role !== 'admin') {
    state.page = 'Dashboard';
    render();
    toast('Access restricted. Administrator privileges are required.', 'error');
    return;
  }

  // Active sub-tab state ('team', 'invites', 'activity', 'roles')
  state.adminTab = state.adminTab || 'team';
  state.adminTeamSearch = state.adminTeamSearch || '';
  state.adminTeamRole = state.adminTeamRole || '';
  state.adminTeamStatus = state.adminTeamStatus || '';
  state.adminInviteStatus = state.adminInviteStatus || '';
  state.adminActivityFilter = state.adminActivityFilter || '';

  // Initialize cached data if not present
  if (!state.adminUsersList) {
    state.adminUsersList = [
      {
        id: state.user?.id || 'admin-id',
        email: state.user?.email || 'admin@msconsulting.in',
        full_name: state.fullName || 'Administrator',
        role: state.role || 'admin',
        is_active: true,
        created_at: new Date().toISOString(),
        has_financial_records: true
      }
    ];
  }
  if (!state.adminInvitesList) state.adminInvitesList = [];
  if (!state.adminMetrics) {
    state.adminMetrics = {
      total_users: state.adminUsersList.length,
      active_users: state.adminUsersList.filter(u => u.is_active).length,
      inactive_users: state.adminUsersList.filter(u => !u.is_active).length,
      pending_invites: state.adminInvitesList.length
    };
  }

  // Render UI INSTANTLY (0ms)
  renderAdminControlCenterView();

  // Background Parallel Refresh (non-blocking)
  const shouldFetch = forceRefresh || !state.adminLastFetched || (Date.now() - state.adminLastFetched > 20000);
  if (shouldFetch) {
    fetchAdminData(forceRefresh);
  }
}

function renderAdminControlCenterView() {
  const usersList = state.adminUsersList || [];
  const invitesList = state.adminInvitesList || [];
  const metrics = state.adminMetrics || { total_users: 1, active_users: 1, inactive_users: 0, pending_invites: 0 };
  const activityLogs = state.adminActivityLogs || [];

  const generatedInvite = state.activeInviteGenerated;

  // Filter Team Members
  const filteredUsers = usersList.filter(u => {
    const q = state.adminTeamSearch.toLowerCase();
    const matchQ = !q || (u.full_name && u.full_name.toLowerCase().includes(q)) || (u.email && u.email.toLowerCase().includes(q));
    const matchRole = !state.adminTeamRole || u.role === state.adminTeamRole;
    const matchStatus = !state.adminTeamStatus || (state.adminTeamStatus === 'active' ? u.is_active : !u.is_active);
    return matchQ && matchRole && matchStatus;
  });

  // Filter Invitations
  const filteredInvites = invitesList.filter(inv => {
    if (!state.adminInviteStatus) return true;
    const isExpired = new Date(inv.expires_at) < new Date();
    const status = inv.status || (inv.used_at ? 'redeemed' : (isExpired ? 'expired' : 'active'));
    return status === state.adminInviteStatus;
  });

  const content = `
    <!-- Top Summary KPI Cards -->
    <div class="admin-summary-grid">
      <div class="admin-summary-card">
        <div class="admin-summary-icon blue">👥</div>
        <div class="admin-summary-content">
          <div class="stat-val">${metrics.total_users}</div>
          <div class="stat-lbl">Total Registered Users</div>
        </div>
      </div>
      <div class="admin-summary-card">
        <div class="admin-summary-icon green">✅</div>
        <div class="admin-summary-content">
          <div class="stat-val">${metrics.active_users}</div>
          <div class="stat-lbl">Active Team Members</div>
        </div>
      </div>
      <div class="admin-summary-card">
        <div class="admin-summary-icon red">⛔</div>
        <div class="admin-summary-content">
          <div class="stat-val">${metrics.inactive_users}</div>
          <div class="stat-lbl">Deactivated Members</div>
        </div>
      </div>
      <div class="admin-summary-card">
        <div class="admin-summary-icon amber">✉️</div>
        <div class="admin-summary-content">
          <div class="stat-val">${metrics.pending_invites}</div>
          <div class="stat-lbl">Pending Invitations</div>
        </div>
      </div>
    </div>

    <!-- Navigation Sub-Tabs -->
    <div class="admin-tabs-nav">
      <button type="button" class="admin-tab-btn ${state.adminTab === 'team' ? 'active' : ''}" data-tab="team">
        👥 Team Members (${usersList.length})
      </button>
      <button type="button" class="admin-tab-btn ${state.adminTab === 'invites' ? 'active' : ''}" data-tab="invites">
        ✉️ Invitations (${invitesList.length})
      </button>
      <button type="button" class="admin-tab-btn ${state.adminTab === 'activity' ? 'active' : ''}" data-tab="activity">
        📜 Activity Log
      </button>
      <button type="button" class="admin-tab-btn ${state.adminTab === 'roles' ? 'active' : ''}" data-tab="roles">
        🛡️ Roles & Permissions
      </button>
    </div>

    <!-- TAB 1: TEAM MEMBERS -->
    ${state.adminTab === 'team' ? `
      <div class="panel">
        <div class="admin-header-row">
          <div>
            <h3>Enterprise Team Directory</h3>
            <p class="muted small" style="margin-top:4px">Manage active staff members, roles, authorization privileges, and session states.</p>
          </div>
          <button type="button" class="btn primary small" id="btnGoToInvites">
            + Generate Invitation
          </button>
        </div>

        <div class="admin-filter-bar">
          <input type="text" id="teamSearchInput" placeholder="Search members by name or email..." value="${esc(state.adminTeamSearch)}">
          <select id="teamRoleSelect">
            <option value="">All Roles</option>
            <option value="admin" ${state.adminTeamRole === 'admin' ? 'selected' : ''}>Administrators</option>
            <option value="staff" ${state.adminTeamRole === 'staff' ? 'selected' : ''}>Staff Members</option>
          </select>
          <select id="teamStatusSelect">
            <option value="">All Statuses</option>
            <option value="active" ${state.adminTeamStatus === 'active' ? 'selected' : ''}>Active Accounts</option>
            <option value="inactive" ${state.adminTeamStatus === 'inactive' ? 'selected' : ''}>Deactivated Accounts</option>
          </select>
          ${(state.adminTeamSearch || state.adminTeamRole || state.adminTeamStatus) ? `
            <button type="button" class="btn secondary small" id="btnClearTeamFilters">Clear Filters</button>
          ` : ''}
        </div>

        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>Member</th>
                <th>Role</th>
                <th>Status</th>
                <th>Created Date</th>
                <th>Last Sign-In</th>
                <th>Last Sign-Out</th>
                <th>Last Activity</th>
                <th style="text-align:right">Manage</th>
              </tr>
            </thead>
            <tbody>
              ${filteredUsers.length === 0 ? `
                <tr><td colspan="8" style="text-align:center;padding:28px;color:var(--text-muted)">No team members match your filter criteria.</td></tr>
              ` : filteredUsers.map(u => {
                const initials = (u.full_name || u.email || 'U').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
                const lastSignInText = u.last_sign_in_at ? formatDate(u.last_sign_in_at) : 'Never';
                const lastSignOutText = u.last_sign_out_at ? `Explicit: ${formatDate(u.last_sign_out_at)}` : 'None recorded (session closed or expired)';
                const lastActivityText = u.last_activity_at ? formatDate(u.last_activity_at) : 'None recorded';

                return `
                  <tr>
                    <td>
                      <div class="user-avatar-cell">
                        <div class="user-avatar-circle ${u.role === 'admin' ? 'admin' : ''}">${esc(initials)}</div>
                        <div>
                          <div class="user-meta-name">${esc(u.full_name || 'Team Member')}</div>
                          <div class="user-meta-sub">${esc(u.email)}</div>
                        </div>
                      </div>
                    </td>
                    <td><span class="user-role-badge role-${u.role}">${esc(u.role?.toUpperCase())}</span></td>
                    <td>
                      <span class="tag ${u.is_active ? 'paid' : 'draft'}">
                        ${u.is_active ? 'Active' : 'Deactivated'}
                      </span>
                    </td>
                    <td>${esc(formatDate(u.created_at))}</td>
                    <td>${esc(lastSignInText)}</td>
                    <td style="font-size:12px;color:var(--text-muted)">${esc(lastSignOutText)}</td>
                    <td style="font-size:12px">${esc(lastActivityText)}</td>
                    <td style="text-align:right">
                      <button type="button" class="btn secondary small btnOpenUserModal" data-user='${esc(JSON.stringify(u))}'>
                        Manage Actions &darr;
                      </button>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    ` : ''}

    <!-- TAB 2: INVITATIONS -->
    ${state.adminTab === 'invites' ? `
      <!-- Generate Secure Invitation -->
      <div class="panel">
        <h3>Generate Team Invitation</h3>
        <p class="muted" style="margin-bottom:16px">
          Issue a single-use cryptographically secure invitation code. Self-registration is permanently disabled.
          The plaintext code is generated once and cannot be retrieved again after leaving this screen.
        </p>

        ${generatedInvite ? `
          <div class="invite-code-card">
            <div>
              <div style="font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px">Generated One-Time Invitation Code</div>
              <div class="invite-code-text" id="displayInviteCode">${esc(generatedInvite.code)}</div>
              <div style="font-size:12px;color:var(--text-muted);margin-top:4px">
                Issued for <strong>${esc(generatedInvite.email)}</strong> (${esc(generatedInvite.role?.toUpperCase())}) &bull; Valid until ${esc(formatDate(generatedInvite.expires_at))}
              </div>
            </div>
            <button type="button" class="btn" id="btnCopyInviteCode" style="background:var(--primary-blue);color:#FFF">
              📋 Copy Invitation Code
            </button>
          </div>
        ` : ''}

        <form id="generateInviteForm">
          <div class="row">
            <div class="field" style="flex:2">
              <label>Recipient Email Address <span class="req">*</span></label>
              <input type="email" name="email" required placeholder="associate@msconsulting.in" autocomplete="off">
            </div>
            <div class="field" style="flex:1.2">
              <label>Assigned Role <span class="req">*</span></label>
              <select name="role" required>
                <option value="staff" selected>Staff Member (Invoices & Customers)</option>
                <option value="admin">Administrator (Full Governance & Settings)</option>
              </select>
            </div>
            <div class="field" style="flex:1">
              <label>Validity Period <span class="req">*</span></label>
              <select name="hours" required>
                <option value="24">24 Hours</option>
                <option value="48" selected>48 Hours</option>
                <option value="168">7 Days</option>
              </select>
            </div>
          </div>
          <div class="row" style="justify-content:flex-end">
            <button type="submit" class="btn primary" id="btnSubmitInvite">Generate Invitation Code &rarr;</button>
          </div>
        </form>
        <div id="inviteResultNotice"></div>
      </div>

      <!-- Issued Invitations Registry -->
      <div class="panel">
        <div class="admin-header-row">
          <div>
            <h3>Invitation Registry</h3>
            <p class="muted small" style="margin-top:4px">Cryptographic invitation hashes stored in PostgreSQL. Status is validated atomically on redemption.</p>
          </div>
          <div style="display:flex;gap:8px">
            <select id="inviteStatusSelect" style="max-width:200px">
              <option value="">All Statuses</option>
              <option value="active" ${state.adminInviteStatus === 'active' ? 'selected' : ''}>Pending (Active)</option>
              <option value="redeemed" ${state.adminInviteStatus === 'redeemed' ? 'selected' : ''}>Redeemed</option>
              <option value="expired" ${state.adminInviteStatus === 'expired' ? 'selected' : ''}>Expired</option>
              <option value="revoked" ${state.adminInviteStatus === 'revoked' ? 'selected' : ''}>Revoked</option>
            </select>
          </div>
        </div>

        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>Recipient Email</th>
                <th>Assigned Role</th>
                <th>Status</th>
                <th>Expires At</th>
                <th>Issued Date</th>
                <th>Redeemed Date</th>
                <th style="text-align:right">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${filteredInvites.length === 0 ? `
                <tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-muted)">No invitations found matching status criteria.</td></tr>
              ` : filteredInvites.map(inv => {
                const isExpired = new Date(inv.expires_at) < new Date();
                const displayStatus = inv.status || (inv.used_at ? 'redeemed' : (isExpired ? 'expired' : 'active'));
                const canRevoke = displayStatus === 'active' && !isExpired && !inv.used_at;
                const canReissue = displayStatus === 'expired' || displayStatus === 'revoked';

                return `
                  <tr>
                    <td><strong>${esc(inv.email)}</strong></td>
                    <td><span class="user-role-badge role-${inv.role}">${esc(inv.role?.toUpperCase())}</span></td>
                    <td><span class="tag ${displayStatus}">${esc(displayStatus)}</span></td>
                    <td>${esc(formatDate(inv.expires_at))}</td>
                    <td>${esc(formatDate(inv.created_at))}</td>
                    <td>${inv.used_at ? esc(formatDate(inv.used_at)) : '—'}</td>
                    <td style="text-align:right">
                      <div class="actions" style="justify-content:flex-end">
                        ${canRevoke ? `
                          <button type="button" class="btn danger small btnRevokeInvite" data-id="${esc(inv.id)}" data-email="${esc(inv.email)}">
                            Revoke
                          </button>
                        ` : ''}
                        ${canReissue ? `
                          <button type="button" class="btn secondary small btnReissueInvite" data-id="${esc(inv.id)}" data-email="${esc(inv.email)}">
                            Reissue Code
                          </button>
                        ` : ''}
                        <button type="button" class="btn secondary small btnDeleteInvite" data-id="${esc(inv.id)}" data-email="${esc(inv.email)}" style="color:var(--danger-red)" title="Delete Invitation">
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    ` : ''}

    <!-- TAB 3: ACTIVITY LOG -->
    ${state.adminTab === 'activity' ? `
      <div class="panel">
        <div class="admin-header-row">
          <div>
            <h3>Security & Activity Ledger</h3>
            <p class="muted small" style="margin-top:4px">Append-only audit ledger recording authentication, authorization, and financial operations.</p>
          </div>
          <div style="display:flex;gap:10px">
            <select id="activityFilterSelect" style="max-width:240px">
              <option value="">All Security Events</option>
              <option value="CLIENT_SIGN_IN_REPORTED" ${state.adminActivityFilter === 'CLIENT_SIGN_IN_REPORTED' ? 'selected' : ''}>Client Sign In Reported</option>
              <option value="CLIENT_SIGN_OUT_REPORTED" ${state.adminActivityFilter === 'CLIENT_SIGN_OUT_REPORTED' ? 'selected' : ''}>Client Sign Out Reported</option>
              <option value="USER_ACTIVATED" ${state.adminActivityFilter === 'USER_ACTIVATED' ? 'selected' : ''}>User Activated</option>
              <option value="USER_DEACTIVATED" ${state.adminActivityFilter === 'USER_DEACTIVATED' ? 'selected' : ''}>User Deactivated</option>
              <option value="USER_ROLE_CHANGED" ${state.adminActivityFilter === 'USER_ROLE_CHANGED' ? 'selected' : ''}>Role Changed</option>
              <option value="USER_SESSIONS_REVOKED" ${state.adminActivityFilter === 'USER_SESSIONS_REVOKED' ? 'selected' : ''}>Sessions Revoked</option>
              <option value="INVITATION_ISSUED" ${state.adminActivityFilter === 'INVITATION_ISSUED' ? 'selected' : ''}>Invitation Issued</option>
              <option value="INVITATION_REISSUED" ${state.adminActivityFilter === 'INVITATION_REISSUED' ? 'selected' : ''}>Invitation Reissued</option>
              <option value="INVITATION_REVOKED" ${state.adminActivityFilter === 'INVITATION_REVOKED' ? 'selected' : ''}>Invitation Revoked</option>
              <option value="INVITATION_REDEEMED" ${state.adminActivityFilter === 'INVITATION_REDEEMED' ? 'selected' : ''}>Invitation Redeemed</option>
              <option value="INVOICE_FINALIZED" ${state.adminActivityFilter === 'INVOICE_FINALIZED' ? 'selected' : ''}>Invoice Finalized</option>
              <option value="INVOICE_CANCELLED" ${state.adminActivityFilter === 'INVOICE_CANCELLED' ? 'selected' : ''}>Invoice Cancelled</option>
              <option value="PAYMENT_RECORDED" ${state.adminActivityFilter === 'PAYMENT_RECORDED' ? 'selected' : ''}>Payment Recorded</option>
            </select>
            <button type="button" class="btn secondary small" id="btnRefreshActivity">Refresh</button>
          </div>
        </div>

        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Actor</th>
                <th>Event Action</th>
                <th>Entity Target</th>
                <th>IP Address</th>
                <th style="text-align:right">Details</th>
              </tr>
            </thead>
            <tbody>
              ${activityLogs.length === 0 ? `
                <tr><td colspan="6" style="text-align:center;padding:28px;color:var(--text-muted)">No activity log records recorded for the selected filter.</td></tr>
              ` : activityLogs.map(log => `
                <tr>
                  <td style="font-size:12.5px;white-space:nowrap">${esc(formatDate(log.created_at))}</td>
                  <td>
                    <div style="font-weight:700;font-size:13px">${esc(log.actor_name || 'System')}</div>
                    <small class="muted">${esc(log.actor_email || 'internal')}</small>
                  </td>
                  <td><span class="tag paid" style="font-family:var(--font-mono);font-size:11px">${esc(log.action)}</span></td>
                  <td><code>${esc(log.entity_type)} / ${esc(log.entity_id ? log.entity_id.slice(0, 8) + '...' : 'none')}</code></td>
                  <td style="font-size:12px;color:var(--text-muted)">${esc(log.ip_address || 'internal')}</td>
                  <td style="text-align:right">
                    <button type="button" class="btn secondary small btnViewLogDetails" data-details='${esc(JSON.stringify(log.details || {}))}'>
                      Inspect
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    ` : ''}

    <!-- TAB 4: ROLES & PERMISSIONS MATRIX -->
    ${state.adminTab === 'roles' ? `
      <div class="panel">
        <div class="admin-header-row">
          <div>
            <h3>Enterprise Role-Based Access Control Matrix</h3>
            <p class="muted small" style="margin-top:4px">Authorization matrix enforced across frontend route dispatchers, backend API endpoints, and PostgreSQL Row Level Security.</p>
          </div>
        </div>

        <div class="table-container">
          <table class="matrix-table">
            <thead>
              <tr>
                <th>System Module</th>
                <th>Staff Member Role</th>
                <th>Administrator Role</th>
                <th>Statutory & Enforcement Policy</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>Dashboard</strong></td>
                <td><span class="matrix-badge-allowed">✓ View Only</span></td>
                <td><span class="matrix-badge-allowed">✓ Full Access</span></td>
                <td>Aggregated KPIs restricted to active sessions.</td>
              </tr>
              <tr>
                <td><strong>Create Invoice</strong></td>
                <td><span class="matrix-badge-restricted">Drafts & Approved Finalization</span></td>
                <td><span class="matrix-badge-allowed">✓ Full Creation</span></td>
                <td>Line items immutable once finalized. Enforced via database triggers.</td>
              </tr>
              <tr>
                <td><strong>Invoice History</strong></td>
                <td><span class="matrix-badge-restricted">View & Download PDF</span></td>
                <td><span class="matrix-badge-allowed">✓ Full Management</span></td>
                <td>Staff cannot cancel or delete invoices. Cancellation requires Administrator RPC.</td>
              </tr>
              <tr>
                <td><strong>Customer Master</strong></td>
                <td><span class="matrix-badge-restricted">Create & Edit</span></td>
                <td><span class="matrix-badge-allowed">✓ Full Management</span></td>
                <td>Staff cannot delete clients. Deletion protected by database RLS.</td>
              </tr>
              <tr>
                <td><strong>Payment Tracking</strong></td>
                <td><span class="matrix-badge-restricted">Record & View</span></td>
                <td><span class="matrix-badge-allowed">✓ Record & Reverse</span></td>
                <td>Staff cannot reverse receipts. Reversals strictly require Administrator authorization.</td>
              </tr>
              <tr>
                <td><strong>Reports & Analytics</strong></td>
                <td><span class="matrix-badge-allowed">✓ View & Export</span></td>
                <td><span class="matrix-badge-allowed">✓ Full Access</span></td>
                <td>Read-only analytics available to all authenticated active members.</td>
              </tr>
              <tr>
                <td><strong>User Management</strong></td>
                <td><span class="matrix-badge-denied">✕ No Access</span></td>
                <td><span class="matrix-badge-allowed">✓ Full Governance</span></td>
                <td>Navigation item hidden. Backend API rejects non-administrators with HTTP 403.</td>
              </tr>
              <tr>
                <td><strong>Company Settings</strong></td>
                <td><span class="matrix-badge-denied">✕ No Access</span></td>
                <td><span class="matrix-badge-allowed">✓ Full Management</span></td>
                <td>Navigation item hidden. Direct updates revoked by PostgreSQL RLS.</td>
              </tr>
              <tr>
                <td><strong>Profile & Security</strong></td>
                <td><span class="matrix-badge-allowed">✓ Self Profile & Password</span></td>
                <td><span class="matrix-badge-allowed">✓ Full Profile & Security</span></td>
                <td>Self-service profile updates permitted. Self-promotion and self-deactivation strictly blocked.</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div style="margin-top:20px;padding:16px;background:var(--bg-subtle);border-radius:var(--radius-md);border:1px solid var(--border-color)">
          <h4 style="margin-bottom:6px;color:var(--text-main)">Statutory Financial Record Retention Policy</h4>
          <p class="muted small" style="line-height:1.6">
            Under Indian GST and financial accounting compliance regulations, finalized invoices, payment receipts, and audit trail records must maintain immutable historical attribution.
            Accounts with associated financial records cannot be permanently deleted. Instead, the supported administrative operation is <strong>Deactivate Account</strong>,
            which immediately terminates all active sessions, revokes database authorization, and denies sign-in while preserving legal audit trails.
          </p>
        </div>
      </div>
    ` : ''}

    <div id="adminActionModalContainer"></div>
  `;

  layout(content, 'Admin Control Center');

  // Sub-Tab Switching
  document.querySelectorAll('[data-tab]').forEach(btn => {
    btn.onclick = () => {
      state.adminTab = btn.dataset.tab;
      renderAdminControlCenterView();
      if (state.adminTab === 'activity') fetchAdminData(true);
    };
  });

  const btnGoToInvites = $('#btnGoToInvites');
  if (btnGoToInvites) {
    btnGoToInvites.onclick = () => {
      state.adminTab = 'invites';
      renderAdminControlCenterView();
    };
  }

  // Team Search & Filter Listeners
  const searchInput = $('#teamSearchInput');
  if (searchInput) {
    searchInput.oninput = () => {
      state.adminTeamSearch = searchInput.value;
      renderAdminControlCenterView();
    };
  }

  const roleSelect = $('#teamRoleSelect');
  if (roleSelect) {
    roleSelect.onchange = () => {
      state.adminTeamRole = roleSelect.value;
      renderAdminControlCenterView();
    };
  }

  const statusSelect = $('#teamStatusSelect');
  if (statusSelect) {
    statusSelect.onchange = () => {
      state.adminTeamStatus = statusSelect.value;
      renderAdminControlCenterView();
    };
  }

  const clearFiltersBtn = $('#btnClearTeamFilters');
  if (clearFiltersBtn) {
    clearFiltersBtn.onclick = () => {
      state.adminTeamSearch = '';
      state.adminTeamRole = '';
      state.adminTeamStatus = '';
      renderAdminControlCenterView();
    };
  }

  // Invite Status Filter
  const inviteStatusSelect = $('#inviteStatusSelect');
  if (inviteStatusSelect) {
    inviteStatusSelect.onchange = () => {
      state.adminInviteStatus = inviteStatusSelect.value;
      renderAdminControlCenterView();
    };
  }

  // Activity Filter & Refresh
  const activityFilterSelect = $('#activityFilterSelect');
  if (activityFilterSelect) {
    activityFilterSelect.onchange = () => {
      state.adminActivityFilter = activityFilterSelect.value;
      renderAdminControlCenterView();
      fetchAdminData(true);
    };
  }

  const btnRefreshActivity = $('#btnRefreshActivity');
  if (btnRefreshActivity) {
    btnRefreshActivity.onclick = () => fetchAdminData(true);
  }

  // Copy Generated Invite Code
  const btnCopy = $('#btnCopyInviteCode');
  if (btnCopy && generatedInvite) {
    btnCopy.onclick = async () => {
      try {
        await navigator.clipboard.writeText(generatedInvite.code);
        btnCopy.innerHTML = '✓ Copied to Clipboard!';
        setTimeout(() => {
          if (btnCopy) btnCopy.innerHTML = '📋 Copy Invitation Code';
        }, 3000);
      } catch (e) {
        toast('Invitation code: ' + generatedInvite.code, 'info');
      }
    };
  }

  // Generate Invite Form Submit
  const generateForm = $('#generateInviteForm');
  if (generateForm) {
    generateForm.onsubmit = async e => {
      e.preventDefault();
      const submitBtn = $('#btnSubmitInvite');
      if (submitBtn) submitBtn.disabled = true;

      const fd = new FormData(generateForm);
      const email = (fd.get('email') || '').trim().toLowerCase();
      const role = fd.get('role') || 'staff';
      const hours = Number(fd.get('hours')) || 48;

      try {
        const token = await getAuthToken();
        const res = await fetch('/api/invite', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ email, role, hours })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to generate invitation.');

        state.activeInviteGenerated = data;
        toast(`Invitation code generated for ${email}!`, 'success');
        userManagement(true);
      } catch (err) {
        const notice = $('#inviteResultNotice');
        if (notice) notice.innerHTML = `<div class="alert">${esc(err.message)}</div>`;
        else toast(err.message, 'error');
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    };
  }

  // Revoke Invitation Handler
  document.querySelectorAll('.btnRevokeInvite').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.getAttribute('data-id');
      const email = btn.getAttribute('data-email');
      if (!confirm(`Are you sure you want to revoke the invitation for ${email}?`)) return;

      try {
        const token = await getAuthToken();
        const res = await fetch('/api/invite', {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ id })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to revoke invitation.');

        toast(`Invitation for ${email} revoked.`, 'info');
        userManagement(true);
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  });

  // Reissue Invitation Handler
  document.querySelectorAll('.btnReissueInvite').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.getAttribute('data-id');
      const email = btn.getAttribute('data-email');
      if (!confirm(`Reissue fresh one-time invitation code for ${email}?`)) return;

      try {
        const token = await getAuthToken();
        const res = await fetch('/api/invite', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ id, action: 'reissue', hours: 48 })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to reissue invitation.');

        state.activeInviteGenerated = data;
        toast(`Invitation reissued for ${email}! Code copied.`, 'success');
        userManagement(true);
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  });

  // Delete Invitation Handler
  document.querySelectorAll('.btnDeleteInvite').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.getAttribute('data-id');
      const email = btn.getAttribute('data-email');
      const inv = (invitesList || []).find(i => i.id === id) || { id, email };

      const confirmed = await showDeleteInviteModal(inv);
      if (!confirmed) return;

      try {
        const token = await getAuthToken();
        const res = await fetch('/api/invite', {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ id, action: 'delete' })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to delete invitation.');

        toast(`Invitation for ${email} deleted permanently.`, 'info');
        userManagement(true);
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  });

  // Inspect Activity Log JSON Details
  document.querySelectorAll('.btnViewLogDetails').forEach(btn => {
    btn.onclick = () => {
      try {
        const detailsObj = JSON.parse(btn.getAttribute('data-details') || '{}');
        const modalContainer = $('#adminActionModalContainer');
        modalContainer.innerHTML = `
          <div class="modal-overlay" id="activityDetailsOverlay">
            <div class="modal" style="max-width:560px">
              <div class="modal-header">
                <h2>Security Event Details</h2>
                <button type="button" class="modal-close" id="btnCloseActivityDetails">&times;</button>
              </div>
              <div class="modal-body">
                <div class="audit-json-box">${esc(JSON.stringify(detailsObj, null, 2))}</div>
              </div>
              <div class="modal-footer">
                <button type="button" class="btn secondary" id="btnDismissActivityDetails">Close</button>
              </div>
            </div>
          </div>
        `;
        const close = () => $('#activityDetailsOverlay')?.remove();
        $('#btnCloseActivityDetails').onclick = close;
        $('#btnDismissActivityDetails').onclick = close;
      } catch (e) {}
    };
  });

  // User Actions Modal Handler
  document.querySelectorAll('.btnOpenUserModal').forEach(btn => {
    btn.onclick = () => {
      const u = JSON.parse(btn.getAttribute('data-user') || '{}');
      const isSelf = u.id === state.user?.id;
      const modalContainer = $('#adminActionModalContainer');

      modalContainer.innerHTML = `
        <div class="modal-overlay" id="userManageModalOverlay">
          <div class="modal" style="max-width:540px">
            <div class="modal-header">
              <div>
                <h2>Manage Team Member</h2>
                <p class="muted small" style="margin-top:2px">${esc(u.full_name)} &bull; ${esc(u.email)}</p>
              </div>
              <button type="button" class="modal-close" id="btnCloseUserModal">&times;</button>
            </div>
            <div class="modal-body" style="display:flex;flex-direction:column;gap:18px">
              <!-- Account Status -->
              <div style="padding:14px;background:var(--bg-subtle);border-radius:var(--radius-sm);border:1px solid var(--border-color)">
                <div style="font-size:12.5px;font-weight:700;color:var(--text-muted);margin-bottom:8px">ACCOUNT ACCESS STATUS</div>
                <div style="display:flex;justify-content:space-between;align-items:center">
                  <div>
                    <span class="tag ${u.is_active ? 'paid' : 'draft'}">${u.is_active ? 'Active' : 'Deactivated'}</span>
                    <span style="font-size:12px;color:var(--text-muted);margin-left:8px">
                      ${u.is_active ? 'Full system access enabled' : 'Account access is revoked'}
                    </span>
                  </div>
                  ${u.is_active ? `
                    <button type="button" class="btn danger small" id="btnModalDeactivate" ${isSelf ? 'disabled title="Cannot deactivate your own account"' : ''}>
                      Deactivate Account
                    </button>
                  ` : `
                    <button type="button" class="btn primary small" id="btnModalActivate">
                      Activate Account
                    </button>
                  `}
                </div>
                ${isSelf ? '<small class="muted" style="display:block;margin-top:6px">Self-deactivation is strictly prohibited for security.</small>' : ''}
              </div>

              <!-- Role Management -->
              <div style="padding:14px;background:var(--bg-subtle);border-radius:var(--radius-sm);border:1px solid var(--border-color)">
                <div style="font-size:12.5px;font-weight:700;color:var(--text-muted);margin-bottom:8px">ROLE-BASED PERMISSIONS</div>
                <div style="display:flex;gap:10px;align-items:center">
                  <select id="modalRoleSelect" style="flex:1" ${isSelf ? 'disabled' : ''}>
                    <option value="staff" ${u.role === 'staff' ? 'selected' : ''}>Staff Member</option>
                    <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Administrator</option>
                  </select>
                  <button type="button" class="btn secondary small" id="btnModalChangeRole" ${isSelf ? 'disabled' : ''}>
                    Update Role
                  </button>
                </div>
                ${isSelf ? '<small class="muted" style="display:block;margin-top:6px">Self-demotion is strictly prohibited for security.</small>' : ''}
              </div>

              <!-- Session Termination -->
              <div style="padding:14px;background:var(--bg-subtle);border-radius:var(--radius-sm);border:1px solid var(--border-color);display:flex;justify-content:space-between;align-items:center">
                <div>
                  <div style="font-size:13px;font-weight:700">Active Sessions</div>
                  <div class="muted small">Invalidate active browser tokens and require sign-in</div>
                </div>
                <button type="button" class="btn secondary small" id="btnModalRevokeSessions">
                  Revoke Sessions
                </button>
              </div>

              <!-- Account Deletion Guard -->
              <div style="padding:14px;background:var(--bg-subtle);border-radius:var(--radius-sm);border:1px solid var(--border-color)">
                <div style="display:flex;justify-content:space-between;align-items:center">
                  <div>
                    <div style="font-size:13px;font-weight:700;color:var(--danger-red)">Account Deletion</div>
                    <div class="muted small">Permanent deletion requires zero financial dependencies</div>
                  </div>
                  <button type="button" class="btn danger small" id="btnModalDeleteAccount" ${isSelf ? 'disabled title="Cannot delete your own account"' : ''}>
                    Delete Account
                  </button>
                </div>
                <small class="muted" style="display:block;margin-top:6px">
                  Statutory compliance requires retaining accounts with invoice or payment records. Deactivate Account should be used instead.
                </small>
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn secondary" id="btnModalDismissUser">Close</button>
            </div>
          </div>
        </div>
      `;

      const closeModal = () => $('#userManageModalOverlay')?.remove();
      $('#btnCloseUserModal').onclick = closeModal;
      $('#btnModalDismissUser').onclick = closeModal;

      // Deactivate action
      const btnDeactivate = $('#btnModalDeactivate');
      if (btnDeactivate) {
        btnDeactivate.onclick = async () => {
          if (!confirm(`Are you sure you want to deactivate ${u.email}? All active sessions will be terminated and sign-in blocked.`)) return;
          try {
            const token = await getAuthToken();
            const res = await fetch('/api/users', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
              body: JSON.stringify({ id: u.id, action: 'deactivate' })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to deactivate user.');
            toast(`Account for ${u.email} has been deactivated.`, 'success');
            closeModal();
            userManagement(true);
          } catch (err) {
            toast(err.message, 'error');
          }
        };
      }

      // Activate action
      const btnActivate = $('#btnModalActivate');
      if (btnActivate) {
        btnActivate.onclick = async () => {
          try {
            const token = await getAuthToken();
            const res = await fetch('/api/users', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
              body: JSON.stringify({ id: u.id, action: 'activate' })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to activate user.');
            toast(`Account for ${u.email} has been activated.`, 'success');
            closeModal();
            userManagement(true);
          } catch (err) {
            toast(err.message, 'error');
          }
        };
      }

      // Change role action
      const btnChangeRole = $('#btnModalChangeRole');
      if (btnChangeRole) {
        btnChangeRole.onclick = async () => {
          const selectedRole = $('#modalRoleSelect').value;
          if (selectedRole === u.role) {
            toast(`User is already assigned the '${selectedRole}' role.`, 'info');
            return;
          }
          if (!confirm(`Are you sure you want to change ${u.email}'s role to ${selectedRole.toUpperCase()}?`)) return;
          try {
            const token = await getAuthToken();
            const res = await fetch('/api/users', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
              body: JSON.stringify({ id: u.id, action: 'change_role', role: selectedRole })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to change role.');
            toast(`Role updated to ${selectedRole.toUpperCase()}.`, 'success');
            closeModal();
            userManagement(true);
          } catch (err) {
            toast(err.message, 'error');
          }
        };
      }

      // Revoke sessions action
      const btnRevokeSessions = $('#btnModalRevokeSessions');
      if (btnRevokeSessions) {
        btnRevokeSessions.onclick = async () => {
          try {
            const token = await getAuthToken();
            const res = await fetch('/api/users', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
              body: JSON.stringify({ id: u.id, action: 'revoke_sessions' })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to revoke sessions.');
            toast(`Active sessions revoked for ${u.email}.`, 'success');
            closeModal();
          } catch (err) {
            toast(err.message, 'error');
          }
        };
      }

      // Delete account action
      const btnDeleteAccount = $('#btnModalDeleteAccount');
      if (btnDeleteAccount) {
        btnDeleteAccount.onclick = async () => {
          if (!confirm(`Are you sure you want to permanently delete ${u.email}? This action cannot be undone.`)) return;
          try {
            const token = await getAuthToken();
            const res = await fetch('/api/users', {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
              body: JSON.stringify({ id: u.id })
            });
            const data = await res.json();
            if (!res.ok) {
              if (data.can_deactivate) {
                alert(data.error);
                return;
              }
              throw new Error(data.error || 'Failed to delete user.');
            }
            toast(`Account for ${u.email} permanently deleted.`, 'success');
            closeModal();
            userManagement(true);
          } catch (err) {
            toast(err.message, 'error');
          }
        };
      }
    };
  });
}

// ============================================================================
// 8. COMPANY SETTINGS (Admin Only)
// ============================================================================
function settings() {
  if (state.role !== 'admin') {
    layout('<div class="notice">Administrator access required.</div>', 'Access Restricted');
    return;
  }

  const s = state.settings || {};

  const content = `
    <div class="panel">
      <h3>Entity Branding & Legal Issuer Configuration</h3>
      <p class="muted" style="margin-bottom:16px">The legal issuer name appears on formal tax invoices independently of customer-facing branding.</p>

      <form id="companySettingsForm">
        <div class="row">
          <div class="field">
            <label>Brand Name</label>
            <input type="text" name="business_name" value="${esc(s.business_name || 'MS Management Consulting')}" required>
          </div>
          <div class="field">
            <label>Legal Invoice Issuer Name <span class="req">*</span></label>
            <input type="text" name="issuer_name" value="${esc(s.issuer_name || s.business_name || 'MS Management Consulting')}" required>
          </div>
        </div>

        <div class="row">
          <div class="field">
            <label>GSTIN</label>
            <input type="text" name="gstin" value="${esc(s.gstin || '')}" style="font-family:var(--font-mono)">
          </div>
          <div class="field">
            <label>PAN</label>
            <input type="text" name="pan" value="${esc(s.pan || '')}" style="font-family:var(--font-mono)">
          </div>
          <div class="field">
            <label>Supplier State Code <span class="req">*</span></label>
            <input type="text" name="state_code" value="${esc(s.state_code || '29')}" required style="font-family:var(--font-mono)">
          </div>
          <div class="field">
            <label>Invoice Prefix</label>
            <input type="text" name="invoice_prefix" value="${esc(s.invoice_prefix || 'INV')}" required>
          </div>
        </div>

        <div class="field">
          <label>Registered Business Address</label>
          <input type="text" name="address" value="${esc(s.address || '')}" placeholder="Official registered business address">
        </div>

        <h3 style="margin-top:20px">Banking Details for Invoice Remittances</h3>
        <div class="row">
          <div class="field">
            <label>Bank Name</label>
            <input type="text" name="bank_name" value="${esc(s.bank_name || '')}" placeholder="Official Bank Name">
          </div>
          <div class="field">
            <label>Beneficiary Account Name</label>
            <input type="text" name="account_name" value="${esc(s.account_name || '')}" placeholder="Account holder name">
          </div>
          <div class="field">
            <label>Account Number</label>
            <input type="text" name="account_number" value="${esc(s.account_number || '')}" placeholder="Bank account number" style="font-family:var(--font-mono)">
          </div>
          <div class="field">
            <label>IFSC Code</label>
            <input type="text" name="ifsc" value="${esc(s.ifsc || '')}" style="font-family:var(--font-mono)">
          </div>
        </div>

        <div class="row">
          <div class="field">
            <label>Default Payment Terms</label>
            <input type="text" name="payment_terms" value="${esc(s.payment_terms || 'Payment due within 15 days.')}">
          </div>
          <div class="field">
            <label>Invoice Footer Note</label>
            <input type="text" name="invoice_footer" value="${esc(s.invoice_footer || 'Computer-generated tax invoice.')}">
          </div>
        </div>

        <div class="row" style="justify-content:flex-end;margin-top:16px">
          <button type="submit" class="btn">Save Company Settings</button>
        </div>
      </form>
    </div>
  `;

  layout(content, 'Company & Invoice Configuration');

  $('#companySettingsForm').onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = Object.fromEntries(fd);
    const targetId = s.id || '00000000-0000-0000-0000-000000000001';

    try {
      const { data, error } = await sb
        .from('company_settings')
        .update({
          ...payload,
          updated_at: new Date().toISOString()
        })
        .eq('id', targetId)
        .select();

      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error('Permission denied: You do not have administrator permissions to update company settings.');
      }
      toast('Company settings updated successfully', 'success');
      await loadData();
      settings();
    } catch (err) {
      console.error('Company settings update error:', err);
      const detail = err.message || String(err);
      const isPermissionError = /permission denied/i.test(detail);
      const message = isPermissionError
        ? 'Unable to save company settings. Please verify that you have administrator access.'
        : 'Unable to save company settings: ' + detail;
      toast(message, 'error');
    }
  };
}

// ============================================================================
// 9. PROFILE & APPEARANCE (Tabs, Theme Settings & Credentials)
// ============================================================================
function profile() {
  const currentTab = state.profileTab || 'personal';
  const currentTheme = state.theme || 'light';
  const isNight = currentTheme === 'dark';
  const extra = state.profileData || {
    phone: '',
    department: 'Consulting',
    designation: 'Staff Member',
    location: 'Bangalore',
    bio: ''
  };

  // Activity Metrics
  const totalInvoices = state.invoices.length;
  const totalBilled = state.invoices.filter(i => i.status !== 'cancelled').reduce((acc, i) => acc + Number(i.total), 0);
  const totalReceived = state.payments.reduce((acc, p) => acc + Number(p.amount), 0);
  const totalCustomers = state.customers.length;

  const content = `
    <div class="profile-wrapper">
      <!-- Profile Hero Card -->
      <div class="profile-hero-card">
        <div class="profile-hero-content">
          <div class="profile-user-info">
            <div class="profile-avatar-large">
              ${(state.fullName || 'U')[0].toUpperCase()}
            </div>
            <div class="profile-details-hero">
              <h2>
                ${esc(state.fullName)}
                <span class="user-role-badge role-${state.role}">${state.role}</span>
              </h2>
              <div class="muted" style="font-size:13.5px;margin-top:2px">${esc(state.user?.email || 'preview@example.com')}</div>
              <div class="profile-badges-row">
                <span class="badge-status">
                  <span class="badge-status-dot"></span> Active Session
                </span>
                <span class="muted" style="font-size:12px">• ${esc(extra.designation || 'Consultant')} • ${esc(extra.department || 'Operations')}</span>
              </div>
            </div>
          </div>

          <!-- Quick Light / Dark Switch on Hero -->
          <div class="profile-hero-toggle">
            <div style="font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.04em">Theme Mode</div>
            <div class="day-night-toggle-widget">
              <button type="button" class="day-night-option-btn ${!isNight && !currentTheme.startsWith('colorful') ? 'active' : ''}" id="heroDayBtn" title="Light Mode">
                ☀️ Light
              </button>
              <button type="button" class="day-night-option-btn ${isNight ? 'active' : ''}" id="heroNightBtn" title="Dark Mode">
                🌙 Dark
              </button>
            </div>
            <span class="hint">Click to switch theme</span>
          </div>
        </div>
      </div>

      <!-- Navigation Tabs -->
      <div class="profile-subnav">
        <button type="button" class="profile-subnav-btn ${currentTab === 'personal' ? 'active' : ''}" data-ptab="personal">
          <span>👤</span>
          <span>Personal Information</span>
        </button>
        <button type="button" class="profile-subnav-btn ${currentTab === 'theme' ? 'active' : ''}" data-ptab="theme">
          <span>🎨</span>
          <span>Theme & Appearance</span>
        </button>
        <button type="button" class="profile-subnav-btn ${currentTab === 'security' ? 'active' : ''}" data-ptab="security">
          <span>🔒</span>
          <span>Security & Credentials</span>
        </button>
        <button type="button" class="profile-subnav-btn ${currentTab === 'activity' ? 'active' : ''}" data-ptab="activity">
          <span>📊</span>
          <span>Activity & Statistics</span>
        </button>
      </div>

      <!-- Tab 1: Personal Info -->
      ${currentTab === 'personal' ? `
        <div class="panel">
          <h3>Personal Details & Information</h3>
          <p class="muted" style="font-size:13px;margin-bottom:20px">Manage your account profile, department role, and contact information.</p>

          <form id="profileFullForm">
            <div class="grid2">
              <div class="field">
                <label>Full Display Name <span class="req">*</span></label>
                <input type="text" name="full_name" value="${esc(state.fullName)}" required placeholder="e.g. Rahul Sharma">
              </div>
              <div class="field">
                <label>Email Address</label>
                <input type="email" value="${esc(state.user?.email || '')}" readonly style="background:var(--bg-subtle);opacity:0.85">
                <small class="muted" style="display:block;margin-top:4px">Email is registered and verified for login</small>
              </div>
            </div>

            <div class="grid2" style="margin-top:16px">
              <div class="field">
                <label>Contact Phone / Mobile</label>
                <input type="text" name="phone" value="${esc(extra.phone || '')}" placeholder="e.g. +91 98000 00000">
              </div>
              <div class="field">
                <label>Department</label>
                <input type="text" name="department" value="${esc(extra.department || '')}" placeholder="e.g. Consulting & Accounts">
              </div>
            </div>

            <div class="grid2" style="margin-top:16px">
              <div class="field">
                <label>Designation / Job Role</label>
                <input type="text" name="designation" value="${esc(extra.designation || '')}" placeholder="e.g. Senior Managing Consultant">
              </div>
              <div class="field">
                <label>Office Location / Branch</label>
                <input type="text" name="location" value="${esc(extra.location || '')}" placeholder="e.g. Bangalore HQ (Indiranagar)">
              </div>
            </div>

            <div class="field" style="margin-top:16px">
              <label>Professional Bio / Notes</label>
              <textarea name="bio" rows="3" placeholder="Brief note about your role in MS Consulting...">${esc(extra.bio || '')}</textarea>
            </div>

            <div style="background:var(--bg-subtle);border:1px solid var(--border-color);border-radius:var(--radius-md);padding:14px 18px;margin-top:20px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
              <div>
                <div style="font-weight:700;font-size:13.5px">System Access Level: <span class="user-role-badge role-${state.role}">${state.role}</span></div>
                <div class="muted" style="font-size:12px;margin-top:2px">
                  ${state.role === 'admin' 
                    ? 'Full Administrator access: Manage all invoices, payments, client directory, team members, and company settings.' 
                    : 'Staff access: Create and manage invoices, record customer payments, and view reporting.'}
                </div>
              </div>
              <button type="submit" class="btn">Save Profile Changes</button>
            </div>
          </form>
        </div>
      ` : ''}

      <!-- Tab 2: Theme & Appearance -->
      ${currentTab === 'theme' ? `
        <div class="panel">
          <h3>Display Themes & Appearance</h3>
          <p class="muted" style="font-size:13px;margin-bottom:20px">Personalize your workspace. Toggle between Light & Dark mode or choose from curated color themes.</p>

          <!-- Main Light / Dark Interactive Switch -->
          <div class="day-night-hero-card">
            <div class="day-night-info">
              <h4>☀️ Light and 🌙 Dark Mode Switch</h4>
              <p class="muted" style="font-size:13px">Instantly switch between Light and Dark display themes across the entire portal.</p>
            </div>
            <div class="day-night-toggle-widget">
              <button type="button" class="day-night-option-btn ${currentTheme === 'light' ? 'active' : ''}" id="themeSwitchDay">
                ☀️ Light Mode
              </button>
              <button type="button" class="day-night-option-btn ${currentTheme === 'dark' ? 'active' : ''}" id="themeSwitchNight">
                🌙 Dark Mode
              </button>
            </div>
          </div>

          <h4 style="margin-top:28px;margin-bottom:8px;font-size:15px;font-weight:800">Curated Color Themes & Presets</h4>
          <p class="muted" style="font-size:12.5px;margin-bottom:16px">Select a tailored color theme to personalize your workspace interface:</p>

          <div class="theme-gallery-grid">
            <!-- Theme 1: Classic Day -->
            <div class="theme-card ${currentTheme === 'light' ? 'active' : ''}" data-set-theme="light">
              <div class="theme-card-top">
                <span class="theme-card-name">☀️ Classic Corporate Light</span>
                ${currentTheme === 'light' ? '<span class="theme-active-tag">Active</span>' : ''}
              </div>
              <div class="theme-swatches">
                <div class="theme-swatch-circle" style="background:#F5F7FB" title="App Background"></div>
                <div class="theme-swatch-circle" style="background:#FFFFFF;border-color:#CBD5E1" title="Card Surface"></div>
                <div class="theme-swatch-circle" style="background:#1769AA" title="Primary Blue"></div>
                <div class="theme-swatch-circle" style="background:#20354E" title="Text Main"></div>
              </div>
              <div class="theme-desc">Clean white layout with high contrast, designed for executive workflows.</div>
            </div>

            <!-- Theme 2: Deep Night -->
            <div class="theme-card ${currentTheme === 'dark' ? 'active' : ''}" data-set-theme="dark">
              <div class="theme-card-top">
                <span class="theme-card-name">🌙 Deep Midnight Dark</span>
                ${currentTheme === 'dark' ? '<span class="theme-active-tag">Active</span>' : ''}
              </div>
              <div class="theme-swatches">
                <div class="theme-swatch-circle" style="background:#0B111E" title="App Background"></div>
                <div class="theme-swatch-circle" style="background:#141E30" title="Card Surface"></div>
                <div class="theme-swatch-circle" style="background:#38BDF8" title="Neon Cyan Accent"></div>
                <div class="theme-swatch-circle" style="background:#F1F5F9" title="Text Main"></div>
              </div>
              <div class="theme-desc">Subdued dark aesthetic designed to reduce eye strain in low-light environments.</div>
            </div>

            <!-- Theme 3: Ocean Blue -->
            <div class="theme-card ${currentTheme === 'colorful-ocean' ? 'active' : ''}" data-set-theme="colorful-ocean">
              <div class="theme-card-top">
                <span class="theme-card-name">🌊 Ocean Blue</span>
                ${currentTheme === 'colorful-ocean' ? '<span class="theme-active-tag">Active</span>' : ''}
              </div>
              <div class="theme-swatches">
                <div class="theme-swatch-circle" style="background:#051424" title="App Background"></div>
                <div class="theme-swatch-circle" style="background:#0A223B" title="Card Surface"></div>
                <div class="theme-swatch-circle" style="background:#0284C7" title="Azure Ocean Accent"></div>
                <div class="theme-swatch-circle" style="background:#7DD3FC" title="Cyan Light"></div>
              </div>
              <div class="theme-desc">Deep navy and azure cyan tones tailored for modern business environments.</div>
            </div>

            <!-- Theme 4: Emerald Mint -->
            <div class="theme-card ${currentTheme === 'colorful-emerald' ? 'active' : ''}" data-set-theme="colorful-emerald">
              <div class="theme-card-top">
                <span class="theme-card-name">🌲 Emerald Forest</span>
                ${currentTheme === 'colorful-emerald' ? '<span class="theme-active-tag">Active</span>' : ''}
              </div>
              <div class="theme-swatches">
                <div class="theme-swatch-circle" style="background:#051812" title="App Background"></div>
                <div class="theme-swatch-circle" style="background:#0C281F" title="Card Surface"></div>
                <div class="theme-swatch-circle" style="background:#10B981" title="Emerald Mint Accent"></div>
                <div class="theme-swatch-circle" style="background:#6EE7B7" title="Mint Glow"></div>
              </div>
              <div class="theme-desc">Lush emerald pine and fresh mint accents with optimal clarity.</div>
            </div>

            <!-- Theme 5: Royal Violet -->
            <div class="theme-card ${currentTheme === 'colorful-purple' ? 'active' : ''}" data-set-theme="colorful-purple">
              <div class="theme-card-top">
                <span class="theme-card-name">🟣 Royal Violet</span>
                ${currentTheme === 'colorful-purple' ? '<span class="theme-active-tag">Active</span>' : ''}
              </div>
              <div class="theme-swatches">
                <div class="theme-swatch-circle" style="background:#0D091D" title="App Background"></div>
                <div class="theme-swatch-circle" style="background:#181135" title="Card Surface"></div>
                <div class="theme-swatch-circle" style="background:#A855F7" title="Vibrant Purple Accent"></div>
                <div class="theme-swatch-circle" style="background:#F472B6" title="Pink Accent"></div>
              </div>
              <div class="theme-desc">Rich royal violet and indigo accents for a distinctive executive appearance.</div>
            </div>

            <!-- Theme 6: Sunset Amber -->
            <div class="theme-card ${currentTheme === 'colorful-sunset' ? 'active' : ''}" data-set-theme="colorful-sunset">
              <div class="theme-card-top">
                <span class="theme-card-name">🌅 Sunset Amber</span>
                ${currentTheme === 'colorful-sunset' ? '<span class="theme-active-tag">Active</span>' : ''}
              </div>
              <div class="theme-swatches">
                <div class="theme-swatch-circle" style="background:#180D08" title="App Background"></div>
                <div class="theme-swatch-circle" style="background:#281710" title="Card Surface"></div>
                <div class="theme-swatch-circle" style="background:#EA580C" title="Sunset Orange"></div>
                <div class="theme-swatch-circle" style="background:#FDBA74" title="Amber Glow"></div>
              </div>
              <div class="theme-desc">Warm amber and terracotta highlights delivering high visual warmth and focus.</div>
            </div>
          </div>
        </div>
      ` : ''}

      <!-- Tab 3: Security & Password -->
      ${currentTab === 'security' ? `
        <div class="panel">
          <h3>Account Security & Password</h3>
          <p class="muted" style="font-size:13px;margin-bottom:20px">Keep your login credentials secure. Use the eye toggle to verify entered passwords.</p>

          <form id="profilePasswordForm" style="max-width:540px">
            <div class="field">
              <label>New Login Password <span class="req">*</span></label>
              <div class="password-wrapper">
                <input type="password" name="new_password" id="newPassInput" required minlength="8" placeholder="Enter new password" autocomplete="new-password">
                <button type="button" class="btn-toggle-pw" title="Show password" aria-label="Show password">
                  ${EYE_OPEN_SVG}
                </button>
              </div>
              <small class="muted" style="display:block;margin-top:4px">Click the eye toggle to view or hide the entered password.</small>
            </div>

            <div class="field" style="margin-top:16px">
              <label>Confirm New Password <span class="req">*</span></label>
              <div class="password-wrapper">
                <input type="password" name="confirm_password" id="confirmPassInput" required minlength="8" placeholder="Re-enter new password" autocomplete="new-password">
                <button type="button" class="btn-toggle-pw" title="Show password" aria-label="Show password">
                  ${EYE_OPEN_SVG}
                </button>
              </div>
            </div>

            <div style="margin-top:20px">
              <button type="submit" class="btn">Update Password</button>
            </div>
          </form>

          <div style="margin-top:32px;padding-top:24px;border-top:1px solid var(--border-color)">
            <h4 style="font-size:15px;font-weight:700;margin-bottom:12px">Security Safeguards</h4>
            <div class="grid2">
              <div style="background:var(--bg-subtle);padding:14px;border-radius:var(--radius-md);border:1px solid var(--border-color)">
                <div style="font-weight:700;font-size:13px;color:var(--success-green);display:flex;align-items:center;gap:6px">
                  <span>🛡️</span> Invitation-Only Registration
                </div>
                <div class="muted" style="font-size:12px;margin-top:4px">Account creation strictly requires a single-use administrator invitation code. Public signups are blocked.</div>
              </div>
              <div style="background:var(--bg-subtle);padding:14px;border-radius:var(--radius-md);border:1px solid var(--border-color)">
                <div style="font-weight:700;font-size:13px;color:var(--primary-blue);display:flex;align-items:center;gap:6px">
                  <span>👁️</span> Password Visibility Controls
                </div>
                <div class="muted" style="font-size:12px;margin-top:4px">All credential fields feature interactive visibility toggles to prevent typing mistakes.</div>
              </div>
            </div>
          </div>
        </div>
      ` : ''}

      <!-- Tab 4: Activity & Stats -->
      ${currentTab === 'activity' ? `
        <div class="panel">
          <h3>Activity Summary & Statistics</h3>
          <p class="muted" style="font-size:13px;margin-bottom:20px">Real-time overview of your invoices, payments, and activity in MS Consulting.</p>

          <div class="profile-stats-grid">
            <div class="pstat-card">
              <span class="pstat-icon">📑</span>
              <div class="pstat-value">${totalInvoices}</div>
              <span class="pstat-label">Total Invoices Created</span>
            </div>
            <div class="pstat-card">
              <span class="pstat-icon">💰</span>
              <div class="pstat-value">${money(totalBilled)}</div>
              <span class="pstat-label">Total Billed Value</span>
            </div>
            <div class="pstat-card">
              <span class="pstat-icon">💳</span>
              <div class="pstat-value">${money(totalReceived)}</div>
              <span class="pstat-label">Total Payments Received</span>
            </div>
            <div class="pstat-card">
              <span class="pstat-icon">🏢</span>
              <div class="pstat-value">${totalCustomers}</div>
              <span class="pstat-label">Registered Customers</span>
            </div>
          </div>

          <div style="background:var(--bg-subtle);border:1px solid var(--border-color);border-radius:var(--radius-md);padding:18px;margin-top:16px">
            <h4 style="font-size:14px;font-weight:700;margin-bottom:8px">Quick Navigation Shortcuts</h4>
            <div class="row" style="gap:10px;flex-wrap:wrap">
              <button type="button" class="btn secondary" id="profileGoDashboard">📊 Open Dashboard</button>
              <button type="button" class="btn secondary" id="profileGoInvoice">📝 Create New Invoice</button>
              <button type="button" class="btn secondary" id="profileGoHistory">📑 View All Invoices</button>
            </div>
          </div>
        </div>
      ` : ''}
    </div>
  `;

  layout(content, 'My Profile & Preferences');

  // Subtab navigation events
  document.querySelectorAll('[data-ptab]').forEach(btn => {
    btn.onclick = () => {
      state.profileTab = btn.dataset.ptab;
      render();
    };
  });

  // Hero Quick Light / Dark Switch
  const heroDayBtn = $('#heroDayBtn');
  if (heroDayBtn) {
    heroDayBtn.onclick = () => {
      applyTheme('light');
      render();
      toast('Light mode activated.', 'info');
    };
  }
  const heroNightBtn = $('#heroNightBtn');
  if (heroNightBtn) {
    heroNightBtn.onclick = () => {
      applyTheme('dark');
      render();
      toast('Dark mode activated.', 'info');
    };
  }

  // Appearance tab Day/Night buttons
  const themeSwitchDay = $('#themeSwitchDay');
  if (themeSwitchDay) {
    themeSwitchDay.onclick = () => {
      applyTheme('light');
      render();
      toast('Light mode activated.', 'info');
    };
  }
  const themeSwitchNight = $('#themeSwitchNight');
  if (themeSwitchNight) {
    themeSwitchNight.onclick = () => {
      applyTheme('dark');
      render();
      toast('Dark mode activated.', 'info');
    };
  }

  // Theme cards click events
  document.querySelectorAll('[data-set-theme]').forEach(card => {
    card.onclick = () => {
      const selectedTheme = card.dataset.setTheme;
      applyTheme(selectedTheme);
      render();
      const themeLabels = {
        'light': 'Classic Corporate Light',
        'dark': 'Deep Midnight Dark',
        'colorful-ocean': 'Ocean Blue',
        'colorful-emerald': 'Emerald Forest',
        'colorful-purple': 'Royal Violet',
        'colorful-sunset': 'Sunset Amber'
      };
      toast(`Theme applied: ${themeLabels[selectedTheme] || selectedTheme}`, 'success');
    };
  });

  // Personal info update form
  const fullForm = $('#profileFullForm');
  if (fullForm) {
    fullForm.onsubmit = async e => {
      e.preventDefault();
      const fd = new FormData(fullForm);
      const name = (fd.get('full_name') || '').trim();
      const phone = (fd.get('phone') || '').trim();
      const department = (fd.get('department') || '').trim();
      const designation = (fd.get('designation') || '').trim();
      const location = (fd.get('location') || '').trim();
      const bio = (fd.get('bio') || '').trim();

      if (name) state.fullName = name;
      state.profileData = { phone, department, designation, location, bio };
      localStorage.setItem('profile_phone', phone);
      localStorage.setItem('profile_department', department);
      localStorage.setItem('profile_designation', designation);
      localStorage.setItem('profile_location', location);
      localStorage.setItem('profile_bio', bio);

      if (state.user && sb) {
        try {
          await sb.from('profiles').update({ full_name: name }).eq('id', state.user.id);
        } catch (err) {
          console.warn('Profile sync:', err);
        }
      }

      toast('Profile information successfully saved!', 'success');
      render();
    };
  }

  // Password update form
  const pwForm = $('#profilePasswordForm');
  if (pwForm) {
    pwForm.onsubmit = async e => {
      e.preventDefault();
      const fd = new FormData(pwForm);
      const newPass = (fd.get('new_password') || '').trim();
      const confirmPass = (fd.get('confirm_password') || '').trim();

      if (!newPass) {
        toast('Please enter a new password.', 'error');
        return;
      }
      if (newPass.length < 8) {
        toast('Password must be at least 8 characters long.', 'error');
        return;
      }
      if (confirmPass && newPass !== confirmPass) {
        toast('Passwords do not match. Please verify and try again.', 'error');
        return;
      }

      try {
        if (sb.auth && sb.auth.updateUser) {
          await sb.auth.updateUser({ password: newPass });
        }
        toast('Password updated successfully.', 'success');
        pwForm.reset();
      } catch (err) {
        toast('Password update error: ' + (err.message || String(err)), 'error');
      }
    };
  }

  // Activity shortcut buttons
  const goDash = $('#profileGoDashboard');
  if (goDash) goDash.onclick = () => { state.page = 'Dashboard'; render(); };
  const goInv = $('#profileGoInvoice');
  if (goInv) goInv.onclick = () => { state.page = 'Create Invoice'; render(); };
  const goHist = $('#profileGoHistory');
  if (goHist) goHist.onclick = () => { state.page = 'Invoice History'; render(); };
}

// ============================================================================
// 10. AUTHENTICATION & BOOTSTRAP SCREEN
// ============================================================================
function auth() {
  const mode = state.authMode;

  const content = `
    <div class="auth">
      <div class="authbox">
        <div style="text-align:center;margin-bottom:12px">
          <img src="/assets/logo.png" alt="MS Management Consulting" style="max-height:68px;max-width:180px;object-fit:contain">
        </div>

        <div class="auth-tabs">
          <button class="auth-tab ${mode === 'login' ? 'active' : ''}" id="tabLogin" type="button">Sign In</button>
          <button class="auth-tab ${mode === 'signup' ? 'active' : ''}" id="tabSignup" type="button">Create Account</button>
        </div>

        ${state.signupSuccessMsg && mode === 'login' ? `
          <div class="notice" style="background:#EBF9F1;border:1px solid #A3E6C0;color:#0E6245;margin-bottom:18px;display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:8px">
            <span style="font-size:18px">✓</span>
            <div style="font-size:13px;font-weight:600;line-height:1.4">${esc(state.signupSuccessMsg)}</div>
          </div>
        ` : ''}

        ${mode === 'login' ? `
          <div style="text-align:center;margin-bottom:18px">
            <h1 style="font-size:20px;margin-bottom:4px">MS Consulting Portal</h1>
            <p style="font-size:13px;color:var(--text-muted)">Sign in to access corporate billing and tax invoices</p>
          </div>

          <form id="authLoginForm">
            <div class="field">
              <label>Email Address <span class="req">*</span></label>
              <input type="email" id="authLoginEmail" name="email" required placeholder="associate@msconsulting.in" autocomplete="username">
            </div>

            <div class="field">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">
                <label style="margin:0">Password <span class="req">*</span></label>
                <button type="button" class="link" id="authForgotPasswordBtn" style="font-size:12px;font-weight:600;color:var(--primary-blue)">Forgot Password?</button>
              </div>
              <div class="password-wrapper">
                <input type="password" id="authLoginPassword" name="password" required placeholder="••••••••" autocomplete="current-password">
                <button type="button" class="btn-toggle-pw" title="Show password" aria-label="Show password">
                  ${EYE_OPEN_SVG}
                </button>
              </div>
            </div>

            <button type="submit" class="btn primary" id="authSubmitLogin" style="width:100%;margin-top:10px;font-weight:700">
              Sign In to Portal &rarr;
            </button>
          </form>

          <div style="margin-top:20px;text-align:center;font-size:13px">
            <p style="color:var(--text-muted)">
              Have an invitation?
              <button class="link" id="authNeedAccount" style="font-weight:700;margin-left:4px">Create Account &rarr;</button>
            </p>
          </div>
        ` : `
          <div style="text-align:center;margin-bottom:18px">
            <h1 style="font-size:20px;margin-bottom:4px">Create Account</h1>
            <p style="font-size:13px;color:var(--text-muted)">Invitation-only registration for MS Consulting personnel</p>
          </div>

          <form id="authSignupForm">
            <div class="field">
              <label>Full Legal Name <span class="req">*</span></label>
              <input type="text" name="full_name" required placeholder="e.g. Ramesh Kumar" autocomplete="name">
            </div>

            <div class="field">
              <label>Email Address <span class="req">*</span></label>
              <input type="email" name="email" required placeholder="associate@msconsulting.in" autocomplete="email">
            </div>

            <div class="field">
              <label>Create Password <span class="req">*</span></label>
              <div class="password-wrapper">
                <input type="password" name="password" required minlength="8" placeholder="Minimum 8 characters" autocomplete="new-password">
                <button type="button" class="btn-toggle-pw" title="Show password" aria-label="Show password">
                  ${EYE_OPEN_SVG}
                </button>
              </div>
            </div>

            <div class="field">
              <label>Confirm Password <span class="req">*</span></label>
              <div class="password-wrapper">
                <input type="password" name="confirm_password" required minlength="8" placeholder="Repeat your password" autocomplete="new-password">
                <button type="button" class="btn-toggle-pw" title="Show password" aria-label="Show password">
                  ${EYE_OPEN_SVG}
                </button>
              </div>
            </div>

            <div class="field">
              <label>Invitation Code <span class="req">*</span></label>
              <input type="text" name="invite_code" required placeholder="INV-XXXXXXXXXXXX" style="font-family:var(--font-mono, monospace);letter-spacing:1px;font-weight:700" autocomplete="off">
              <small style="color:var(--text-muted);font-size:11.5px;margin-top:2px">Single-use code issued by your system administrator.</small>
            </div>

            <button type="submit" class="btn primary" id="authSubmitSignup" style="width:100%;margin-top:12px;font-weight:700">
              Register Account &rarr;
            </button>
          </form>

          <div style="margin-top:20px;text-align:center;font-size:13px">
            <p style="color:var(--text-muted)">
              Already registered?
              <button class="link" id="authAlreadyHave" style="font-weight:700;margin-left:4px">&larr; Sign In</button>
            </p>
          </div>
        `}

        <div id="authAlertBox"></div>
      </div>
    </div>
  `;

  $('#app').innerHTML = content;

  if ($('#tabLogin')) $('#tabLogin').onclick = () => { state.authMode = 'login'; auth(); };
  if ($('#tabSignup')) $('#tabSignup').onclick = () => { state.authMode = 'signup'; auth(); };
  if ($('#authNeedAccount')) $('#authNeedAccount').onclick = () => { state.authMode = 'signup'; auth(); };
  if ($('#authAlreadyHave')) $('#authAlreadyHave').onclick = () => { state.authMode = 'login'; auth(); };

  // Forgot password handler
  const btnForgot = $('#authForgotPasswordBtn');
  if (btnForgot) {
    btnForgot.onclick = async () => {
      const email = prompt('Enter your registered email address to receive password reset instructions:');
      if (!email || !email.trim()) return;
      try {
        const { error } = await sb.auth.resetPasswordForEmail(email.trim().toLowerCase());
        if (error) throw error;
        toast('Password recovery instructions dispatched if account exists.', 'info');
      } catch (e) {
        toast(e.message || 'Unable to request password recovery.', 'error');
      }
    };
  }

  // Sign Up Form (Requires valid invitation code, processed by backend)
  const signupForm = $('#authSignupForm');
  if (signupForm) {
    signupForm.onsubmit = async e => {
      e.preventDefault();
      const alertBox = $('#authAlertBox');
      alertBox.innerHTML = '';

      const submitBtn = $('#authSubmitSignup');
      if (submitBtn) submitBtn.disabled = true;

      const fd = new FormData(signupForm);
      const fullName = (fd.get('full_name') || '').trim();
      const email = (fd.get('email') || '').trim().toLowerCase();
      const password = (fd.get('password') || '').trim();
      const confirmPassword = (fd.get('confirm_password') || '').trim();
      const inviteCode = (fd.get('invite_code') || '').trim();

      if (!fullName || !email || !password || !inviteCode) {
        alertBox.innerHTML = '<div class="alert">Please fill in all required fields.</div>';
        if (submitBtn) submitBtn.disabled = false;
        return;
      }

      if (password.length < 8) {
        alertBox.innerHTML = '<div class="alert">Password must be at least 8 characters long.</div>';
        if (submitBtn) submitBtn.disabled = false;
        return;
      }

      if (password !== confirmPassword) {
        alertBox.innerHTML = '<div class="alert">Password confirmation does not match.</div>';
        if (submitBtn) submitBtn.disabled = false;
        return;
      }

      try {
        const res = await fetch('/api/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            full_name: fullName,
            email,
            password,
            confirm_password: confirmPassword,
            invite_code: inviteCode
          })
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Registration failed.');
        }

        state.authMode = 'login';
        state.signupSuccessMsg = data.message || 'Account registered successfully! Please sign in with your credentials.';
        auth();
      } catch (err) {
        alertBox.innerHTML = `<div class="alert">${esc(err.message || 'Registration processing failed.')}</div>`;
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    };
  }

  // Login Form (Pure Supabase Auth)
  const loginForm = $('#authLoginForm');
  if (loginForm) {
    loginForm.onsubmit = async e => {
      e.preventDefault();
      const alertBox = $('#authAlertBox');
      alertBox.innerHTML = '';

      const submitBtn = $('#authSubmitLogin');
      if (submitBtn) submitBtn.disabled = true;

      const fd = new FormData(loginForm);
      const email = (fd.get('email') || '').trim().toLowerCase();
      const password = (fd.get('password') || '').trim();

      if (!email || !password) {
        alertBox.innerHTML = '<div class="alert">Please enter both email and password.</div>';
        if (submitBtn) submitBtn.disabled = false;
        return;
      }

      try {
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error) {
          throw error;
        }

        if (!data?.user) {
          throw new Error('Authentication failed. No user record returned.');
        }

        // Check active status in profile
        const { data: prof } = await sb
          .from('profiles')
          .select('role, full_name, is_active')
          .eq('id', data.user.id)
          .maybeSingle();

        if (prof && prof.is_active === false) {
          await sb.auth.signOut();
          throw new Error('This account has been deactivated. Please contact an administrator.');
        }

        state.user = data.user;
        state.role = prof?.role || data.user.user_metadata?.role || 'staff';
        state.fullName = prof?.full_name || data.user.user_metadata?.full_name || email.split('@')[0];
        state.signupSuccessMsg = '';

        await loadData();
        toast('Welcome back, ' + state.fullName + '!', 'success');

        if (data?.session?.access_token) {
          fetch('/api/audit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${data.session.access_token}` },
            body: JSON.stringify({ action: 'CLIENT_SIGN_IN_REPORTED' })
          }).catch(() => {});
        }

        render();
      } catch (err) {
        alertBox.innerHTML = `<div class="alert">${esc(err.message || 'Login failed. Please verify credentials.')}</div>`;
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    };
  }
}

// ============================================================================
// 11. INVOICE PDF GENERATION (Matching MADHU M. S. / MS Consulting Layout)
// ============================================================================
export async function generateInvoicePDF(inv) {
  const cust = state.customers.find(c => c.id === inv.customer_id) || (inv.customers || {});
  const s = state.settings || {};
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });

  // Page dimensions: 210 x 297 mm
  const startX = 12;
  const startY = 12;
  const endX = 198;
  const totalW = endX - startX; // 186 mm
  let curY = startY;

  const navyColor = [11, 56, 102];
  const blackColor = [0, 0, 0];

  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.35);

  // 1. TOP HEADER (BRANDING & ISSUER)
  try {
    if (LOGO_BASE64) {
      doc.addImage(LOGO_BASE64, 'PNG', startX + 3, curY + 3, 30, 20);
    }
  } catch (e) {
    console.warn('Could not add logo to PDF:', e);
  }

  // Centered Company / Issuer Info
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(...navyColor);
  doc.text(s.issuer_name || 'MADHU M. S.', 108, curY + 8, { align: 'center' });

  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.text('SNO.125, 1ST FLOOR, 12TH CROSS 6TH MAIN, 3RD PHASE,', 108, curY + 14, { align: 'center' });
  doc.text('J.P.NAGAR, BANGALORE-560078, KARNATAKA', 108, curY + 19, { align: 'center' });

  doc.setFontSize(8);
  doc.text(`PHONE: ${s.phone || '9964287173'} EMAIL: ${s.email || 'madhumsiddu@gmail.com'}`, 108, curY + 24, { align: 'center' });

  curY += 27;

  // Horizontal line above the document status banner
  doc.line(startX, curY, endX, curY);

  // 2. DOCUMENT STATUS BANNER (DRAFT INVOICE / TAX INVOICE / — CANCELLED)
  //    Identical rules to the View modal and browser print output.
  const docHeading = invoiceHeading(inv);
  const bannerH = 7;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...blackColor);
  doc.text(docHeading, 105, curY + 5, { align: 'center' });

  curY += bannerH;
  // Horizontal line below TAX INVOICE
  doc.line(startX, curY, endX, curY);

  // 3. TWO-COLUMN SECTION: BILL TO (LEFT) & METADATA (RIGHT)
  const metaSplitX = 118; // x-coordinate dividing left and right
  const metaSectionTopY = curY;
  const metaSectionH = 36; // 6 rows of meta = 6mm each

  // Left Column (Bill To)
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text('To,', startX + 3, curY + 5.5);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text((cust.name || 'CLIENT NAME').toUpperCase(), startX + 3, curY + 11);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  const custAddr = (cust.billing_address || '#810 , 5TH BLOCK , 100 FEET OUTER RING ROAD\nHOSKEREHALLI , BANASHANKARI 3RD STAGE') + '\n' +
    (cust.city || 'BANGALORE') + ', ' + (cust.state || 'KARNATAKA') + (cust.pin_code ? '-' + cust.pin_code : '-560085');
  const addrLines = doc.splitTextToSize(custAddr, metaSplitX - startX - 6);
  doc.text(addrLines, startX + 3, curY + 16);

  doc.setFont('helvetica', 'bold');
  doc.text(`GSTIN NO: ${cust.gstin || '—'}`, startX + 3, curY + 32);

  // Vertical line separating Left and Right
  doc.line(metaSplitX, metaSectionTopY, metaSplitX, metaSectionTopY + metaSectionH);

  // Right Column: Table with 6 rows
  const metaDividerX = 152;
  const metaRows = [
    ['Invoice No', inv.invoice_number],
    ['Invoice Date', formatInvoiceDate(inv.invoice_date)],
    ['PAN', s.pan || 'APEPM7494M'],
    ['GSTIN NO', s.gstin || '29APEPM7494M1ZZ'],
    ['Place of Supply', inv.place_of_supply || 'Karnataka'],
    ['State Code', s.state_code || '29']
  ];

  const rowH = metaSectionH / 6;
  metaRows.forEach((row, idx) => {
    const rowY = metaSectionTopY + (idx * rowH);
    if (idx > 0) {
      doc.line(metaSplitX, rowY, endX, rowY);
    }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(row[0], metaSplitX + 3, rowY + 4.5);

    doc.setFont('helvetica', idx === 0 ? 'bold' : 'normal');
    doc.text(String(row[1] || '—'), metaDividerX + 3, rowY + 4.5);
  });
  doc.line(metaDividerX, metaSectionTopY, metaDividerX, metaSectionTopY + metaSectionH);

  curY = metaSectionTopY + metaSectionH;
  doc.line(startX, curY, endX, curY);

  // 4. ITEMS TABLE
  const col1X = startX;
  const col2X = metaSplitX; // 118
  const col3X = metaDividerX; // 152
  const tableTopY = curY;
  const headerRowH = 7;

  // Header row
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('PARTICULARS', col1X + 45, curY + 5, { align: 'center' });
  doc.text('HSN/SAC', col2X + 17, curY + 5, { align: 'center' });
  doc.text('AMOUNT ( Rs. )', col3X + 23, curY + 5, { align: 'center' });

  curY += headerRowH;
  doc.line(startX, curY, endX, curY);

  const tableBodyTopY = curY;
  const tableItemsH = 68; // Height for line items area

  // Print line items
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  let itemY = curY + 6;

  const itemsList = inv.items && inv.items.length ? inv.items : [{
    description: inv.description || 'Professional Services for Management Consultancy\nfor the month of September - 2026',
    hsn_sac: inv.hsn_sac || '998312',
    amount: inv.subtotal
  }];

  itemsList.forEach(it => {
    const descLines = doc.splitTextToSize(it.description, col2X - col1X - 6);
    doc.text(descLines, col1X + 3, itemY);
    doc.text(it.hsn_sac || '998312', col2X + 17, itemY, { align: 'center' });
    doc.text(Number(it.amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), endX - 4, itemY, { align: 'right' });
    itemY += (descLines.length * 5) + 3;
  });

  const summaryTopY = tableBodyTopY + tableItemsH;
  const isIntrastate = inv.tax_type === 'CGST + SGST' || !inv.tax_type;
  const summaryH = isIntrastate ? 21 : 14;

  // Vertical column dividers through table body and summary
  doc.line(col2X, tableTopY, col2X, summaryTopY + summaryH);
  doc.line(col3X, tableTopY, col3X, summaryTopY + summaryH);

  let sumY = summaryTopY;
  doc.line(col2X, sumY, endX, sumY);

  if (isIntrastate) {
    // CGST row
    doc.setFont('helvetica', 'normal');
    doc.text(`CGST @ ${inv.gst_rate ? inv.gst_rate / 2 : 9}%`, col2X + 17, sumY + 5, { align: 'center' });
    doc.text(Number(inv.cgst || (inv.tax_amount / 2)).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), endX - 4, sumY + 5, { align: 'right' });
    sumY += 7;
    doc.line(col2X, sumY, endX, sumY);

    // SGST row
    doc.setFont('helvetica', 'normal');
    doc.text(`SGST @ ${inv.gst_rate ? inv.gst_rate / 2 : 9}%`, col2X + 17, sumY + 5, { align: 'center' });
    doc.text(Number(inv.sgst || (inv.tax_amount / 2)).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), endX - 4, sumY + 5, { align: 'right' });
    sumY += 7;
    doc.line(col2X, sumY, endX, sumY);
  } else {
    // IGST row
    doc.setFont('helvetica', 'normal');
    doc.text(`IGST @ ${inv.gst_rate || 18}%`, col2X + 17, sumY + 5, { align: 'center' });
    doc.text(Number(inv.tax_amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), endX - 4, sumY + 5, { align: 'right' });
    sumY += 7;
    doc.line(col2X, sumY, endX, sumY);
  }

  // TOTAL row
  doc.setFont('helvetica', 'bold');
  doc.text('TOTAL', col2X + 17, sumY + 5, { align: 'center' });
  doc.text(Number(inv.total).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), endX - 4, sumY + 5, { align: 'right' });
  sumY += 7;

  curY = sumY;
  doc.line(startX, curY, endX, curY);

  // 5. AMOUNT IN WORDS ROW
  const wordsH = 8;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text(inv.amount_in_words || amountInWords(inv.total), startX + 3, curY + 5.5);

  curY += wordsH;
  doc.line(startX, curY, endX, curY);

  // 6. BOTTOM SECTION: 2 BOXES (BANK DETAILS & AUTHORISED SIGNATORY)
  const bottomBoxY = curY + 4;
  const bankBoxW = 104;
  const sigBoxW = totalW - bankBoxW - 4; // 78 mm
  const sigBoxX = startX + bankBoxW + 4;

  // Left Box: Bank Details Table
  const bankRows = [
    ['Bank Name:', s.bank_name || 'STATE BANK OF INDIA'],
    ['Bank Address:', s.branch || 'JP NAGAR 1ST PHASE, BANGALORE KARNATAKA - 560078'],
    ['SBI Bank A/c Name:', s.account_name || 'MADHU M S'],
    ['SBI BANK A/C NO.:', s.account_number || '20300723746'],
    ['RTGS/NEFT/IFSC:', s.ifsc || 'SBIN0007117']
  ];

  const bankColSplit = startX + 38;
  const valueWrapW = bankBoxW - 41;

  // Pre-wrap every value so each row can be sized to its real line count.
  // This stops a long address (e.g. the branch line ending in the pincode)
  // from overflowing a fixed-height row and spilling onto the row below.
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  const bankRowDefs = bankRows.map(r => ({
    label: r[0],
    valueLines: doc.splitTextToSize(String(r[1]), valueWrapW)
  }));

  const BANK_LINE_H = 3.6;
  const BANK_ROW_PAD = 3;
  const bankRowHeights = bankRowDefs.map(def =>
    Math.max(6.5, def.valueLines.length * BANK_LINE_H + BANK_ROW_PAD)
  );
  const bottomBoxH = bankRowHeights.reduce((a, b) => a + b, 0);

  doc.rect(startX, bottomBoxY, bankBoxW, bottomBoxH);
  doc.line(bankColSplit, bottomBoxY, bankColSplit, bottomBoxY + bottomBoxH);

  let bankRowY = bottomBoxY;
  bankRowDefs.forEach((def, idx) => {
    const rH = bankRowHeights[idx];
    if (idx > 0) {
      doc.line(startX, bankRowY, startX + bankBoxW, bankRowY);
    }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.text(def.label, startX + 2, bankRowY + 4.5);
    // Vertically centre the (possibly multi-line) value within its row.
    const blockH = def.valueLines.length * BANK_LINE_H;
    const valueTop = bankRowY + Math.max(0, (rH - blockH) / 2) + BANK_LINE_H - 0.7;
    doc.text(def.valueLines, bankColSplit + 2, valueTop);
    bankRowY += rH;
  });

  // Right Box: Signature Block
  doc.rect(sigBoxX, bottomBoxY, sigBoxW, bottomBoxH);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text(`For ${s.issuer_name || 'MADHU M. S.'}`, sigBoxX + (sigBoxW / 2), bottomBoxY + 5.5, { align: 'center' });

  // Authentic Signature Image
  try {
    if (SIGNATURE_BASE64) {
      doc.addImage(SIGNATURE_BASE64, 'PNG', sigBoxX + (sigBoxW / 2) - 18, bottomBoxY + 8, 36, 15);
    }
  } catch (e) {
    console.warn('Could not add signature image to PDF:', e);
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('AUTHORISED SIGNATORY', sigBoxX + (sigBoxW / 2), bottomBoxY + 30, { align: 'center' });

  // Outer border enclosing the document
  const finalDocH = (bottomBoxY + bottomBoxH + 4) - startY;
  doc.rect(startX, startY, totalW, finalDocH);

  // 7. STATUS WATERMARK (DRAFT / CANCELLED)
  //    Rendered as large, rotated, low-opacity text across the page centre so
  //    it stays clearly visible in exported PDFs without obscuring any
  //    invoice details, GST figures, bank details or the signature.
  const pdfWatermark = invoiceWatermark(inv);
  if (pdfWatermark) {
    try {
      doc.setGState(new doc.GState({ opacity: 0.10 }));
      doc.setTextColor(0, 0, 0);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(58);
      doc.text(pdfWatermark, 105, 165, { align: 'center', angle: 45 });
      doc.setGState(new doc.GState({ opacity: 1 }));
    } catch (e) {
      console.warn('Could not render document status watermark on PDF:', e);
    }
  }

  // Save PDF
  doc.save(`${inv.invoice_number.replace(/\//g, '_')}.pdf`);
  toast(`Invoice PDF downloaded: ${inv.invoice_number}`, 'success');
}

// ============================================================================
// MAIN ROUTER & RENDER
// ============================================================================
export function render() {
  if (!state.user) return auth();

  // Centralized Route Guard: Restrict Admin-only modules from non-admins
  const adminOnlyPages = ['User Management', 'Company Settings'];
  if (adminOnlyPages.includes(state.page) && state.role !== 'admin') {
    state.page = 'Dashboard';
    toast('Access denied. Administrator privileges are required.', 'error');
  }

  switch (state.page) {
    case 'Dashboard': dashboard(); break;
    case 'Create Invoice': invoiceForm(); break;
    case 'Invoice History': history(); break;
    case 'Customer Master': customers(); break;
    case 'Payment Tracking': payments(); break;
    case 'Reports & Analytics': reports(); break;
    case 'User Management': userManagement(); break;
    case 'Company Settings': settings(); break;
    case 'Profile': profile(); break;
    default: dashboard();
  }
}

// Initial Boot
(async () => {
  if (sb) {
    try {
      const { data: sessionData } = await sb.auth.getSession();
      state.sessionToken = sessionData?.session?.access_token || null;
    } catch {}
    const { data } = await sb.auth.getUser();
    state.user = data?.user || null;
    if (state.user) await loadData();
    sb.auth.onAuthStateChange(async (event, session) => {
      state.sessionToken = session?.access_token || null;
      if (event === 'SIGNED_OUT') {
        state.user = null;
        state.sessionToken = null;
        render();
      } else if (event === 'SIGNED_IN' && session?.user?.id !== state.user?.id) {
        state.user = session.user;
        state.sessionToken = session.access_token;
        await loadData();
        render();
      }
    });
  }
  render();
})();
