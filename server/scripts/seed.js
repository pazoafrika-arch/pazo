/**
 * Seeds a complete, believable demo dataset:
 *   - The Travela business with a live API key and funded wallet
 *   - Pazo admin + super admin
 *   - 3 institution partners, 4 individual agents, 1 pending application
 *   - ~3 months of referrals, transactions, clicks, withdrawals, payouts
 *   - Notifications, wallet ledger, audit trail, settings, CMS content
 *
 *   npm run seed        (safe to re-run: wipes seeded tables first)
 */
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';
import crypto from 'node:crypto';
import env from '../src/config/env.js';
import { DEFAULT_SETTINGS } from '../src/services/settings.js';

const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
const dt = (d) => new Date(d).toISOString().slice(0, 19).replace('T', ' ');
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (arr) => arr[rand(0, arr.length - 1)];
const chance = (p) => Math.random() < p;

const AVATAR_COLORS = ['#007b84', '#0D2137', '#2C6E6E', '#0F3460', '#0E7490', '#B45309', '#047857'];
const colorFor = (seed) =>
  AVATAR_COLORS[parseInt(sha256(seed).slice(0, 8), 16) % AVATAR_COLORS.length];

// Realistic bundle pricing: USD price x ~2570 TZS.
const BUNDLES = [
  { name: 'Tanzania 3-Day 1GB', price: 12850 },
  { name: 'Tanzania 7-Day 5GB', price: 30840 },
  { name: 'Tanzania 14-Day 15GB', price: 61680 },
  { name: 'Tanzania 30-Day 30GB', price: 102800 },
  { name: 'East Africa 7-Day 5GB', price: 46260 },
  { name: 'East Africa 30-Day 20GB', price: 128500 },
];

const DEMO_PASSWORD = 'Demo2026!';
const ADMIN_PASSWORD = 'Admin2026!';

const TABLES_TO_CLEAR = [
  'gateway_events',
  'gateway_requests',
  'wallet_topups',
  'api_request_log',
  'audit_log',
  'communications',
  'message_templates',
  'announcements',
  'notifications',
  'wallet_ledger',
  'institution_payouts',
  'withdrawals',
  'transactions',
  'referrals',
  'referral_clicks',
  'partners',
  'institution_applications',
  'business_members',
  'institution_profiles',
  'individual_profiles',
  'refresh_tokens',
  'otp_codes',
  'businesses',
  'users',
  'platform_settings',
  'cms_content',
];

async function main() {
  const conn = await mysql.createConnection({
    host: env.db.host,
    port: env.db.port,
    user: env.db.user,
    password: env.db.password,
    database: env.db.database,
    multipleStatements: true,
  });

  const q = (sql, params = []) => conn.execute(sql, params);

  console.log('\n  Clearing existing data...');
  await conn.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const t of TABLES_TO_CLEAR) await conn.query(`TRUNCATE TABLE ${t}`);
  await conn.query('SET FOREIGN_KEY_CHECKS = 1');

  const demoHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const adminHash = await bcrypt.hash(ADMIN_PASSWORD, 10);

  /* ---------------- settings + CMS ---------------- */
  console.log('  Seeding platform settings and site content...');
  for (const [key, value, type, category, label, description] of DEFAULT_SETTINGS) {
    await q(
      `INSERT INTO platform_settings (setting_key, setting_value, value_type, category, label, description)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [key, value, type, category, label, description],
    );
  }

  const CMS = [
    ['hero_eyebrow', 'Partner programme · Powered by Pazo', 'landing', 'Hero eyebrow', 1],
    ['hero_title', 'Refer. Connect. Earn.', 'landing', 'Hero headline', 2],
    [
      'hero_subtitle',
      'The Travela gives anyone instant mobile connectivity wherever they travel — no roaming fees, no paperwork. Share your link and earn every time someone connects through you.',
      'landing',
      'Hero subtitle',
      3,
    ],
    ['hero_cta', 'Join us', 'landing', 'Hero button label', 4],
    ['hero_image_url', '', 'landing', 'Hero image URL — leave empty to show a placeholder', 5],
    [
      'hero_image_alt',
      'A Tanzanian guide sharing his referral QR code with two travellers below Mount Kilimanjaro',
      'landing',
      'Hero image description — read aloud by screen readers',
      6,
    ],
    ['steps_eyebrow', 'How it works', 'landing', 'Steps eyebrow', 5],
    ['steps_title', 'Simple. Earn forever.', 'landing', 'Steps headline', 6],
    ['step_1_title', 'Create your account and get your code', 'landing', 'Step 1 title', 7],
    [
      'step_1_body',
      'Sign up and choose your personal referral code. Your link and QR code are generated automatically, ready to share anywhere.',
      'landing',
      'Step 1 body',
      8,
    ],
    ['step_2_title', 'Share your link, QR, or code', 'landing', 'Step 2 title', 9],
    [
      'step_2_body',
      'Someone scans your QR, taps your link, or types your code when they create a Travela account. They get connectivity in minutes.',
      'landing',
      'Step 2 body',
      10,
    ],
    ['step_3_title', 'They connect. You get paid.', 'landing', 'Step 3 title', 11],
    [
      'step_3_body',
      'Every time that traveller buys data — today or months from now — you earn commission. Refer once and keep earning.',
      'landing',
      'Step 3 body',
      12,
    ],
    ['login_eyebrow', 'Partner access', 'landing', 'Login section eyebrow', 13],
    ['login_title', 'Already joined? Log in to your account.', 'landing', 'Login section title', 14],
    ['faq_1_q', 'When do I get paid?', 'faq', 'FAQ 1 question', 20],
    [
      'faq_1_a',
      'Individual partners are paid instantly to mobile money and can withdraw any time above the minimum. Organisations accumulate a monthly balance that is paid on the 1st of each month.',
      'faq',
      'FAQ 1 answer',
      21,
    ],
    ['faq_2_q', 'How much do I earn?', 'faq', 'FAQ 2 question', 22],
    [
      'faq_2_a',
      'You earn a percentage of every purchase your referrals make — their first bundle and every top-up after it, for as long as they keep buying.',
      'faq',
      'FAQ 2 answer',
      23,
    ],
    ['faq_3_q', 'Do I see who signed up?', 'faq', 'FAQ 3 question', 24],
    [
      'faq_3_a',
      'No. Traveller names, emails and phone numbers are never shared with partners. You see the commission amount, the bundle and the date.',
      'faq',
      'FAQ 3 answer',
      25,
    ],
    ['footer_note', 'Partner programme for The Travela · Powered by Pazo', 'footer', 'Footer note', 30],
  ];
  for (const [key, value, group, label, order] of CMS) {
    await q(
      `INSERT INTO cms_content (content_key, content_value, value_type, group_name, label, sort_order)
       VALUES (?, ?, 'text', ?, ?, ?)`,
      [key, value, group, label, order],
    );
  }

  /* ---------------- business ---------------- */
  console.log('  Creating The Travela business...');
  const businessId = uuid();
  const apiKeySecret = crypto.randomBytes(16).toString('hex');
  const apiKey = `pazo_live_${apiKeySecret}`;

  await q(
    `INSERT INTO businesses
       (id, name, website, slug, category, signup_url_template, api_key_hash, api_key_prefix,
        api_key_last_four, api_key_rotated_at, commission_rate, platform_fee_rate,
        wallet_balance_tzs, wallet_alert_threshold_tzs, notification_email, status, created_at)
     VALUES (?, 'The Travela', 'thetravela.com', 'thetravela', 'eSIM & connectivity',
             'https://thetravela.com/signup?ref={CODE}', ?, 'pazo_live', ?, UTC_TIMESTAMP(),
             0.0800, 0.0100, 5499800, 500000, 'ops@thetravela.com', 'active', ?)`,
    [businessId, sha256(apiKey), apiKeySecret.slice(-4), dt(Date.now() - 120 * 86400000)],
  );

  /* ---------------- users ---------------- */
  console.log('  Creating users...');
  const mkUser = async (u) => {
    const id = uuid();
    await q(
      `INSERT INTO users (id, email, phone, password_hash, role, status, name, avatar_color,
                          email_verified, phone_verified, last_login_at, created_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?, 1, ?, ?, ?)`,
      [
        id,
        u.email || null,
        u.phone || null,
        u.password || demoHash,
        u.role,
        u.name,
        colorFor(id),
        u.phone ? 1 : 0,
        dt(Date.now() - rand(1, 72) * 3600000),
        dt(u.createdAt || Date.now() - 90 * 86400000),
      ],
    );
    return id;
  };

  const travelaOwnerId = await mkUser({
    email: 'demo@thetravela.com',
    name: 'The Travela Operations',
    role: 'business_owner',
  });
  await q(
    "INSERT INTO business_members (id, business_id, user_id, access, is_owner) VALUES (?, ?, ?, 'full', 1)",
    [uuid(), businessId, travelaOwnerId],
  );

  const travelaAnalystId = await mkUser({
    email: 'analyst@thetravela.com',
    name: 'Joseph Mtei',
    role: 'business_owner',
  });
  await q(
    "INSERT INTO business_members (id, business_id, user_id, access, is_owner) VALUES (?, ?, ?, 'read_only', 0)",
    [uuid(), businessId, travelaAnalystId],
  );

  const superAdminId = await mkUser({
    email: 'admin@pazo.co.tz',
    name: 'Pazo Super Admin',
    role: 'super_admin',
    password: adminHash,
  });
  await mkUser({
    email: 'ops@pazo.co.tz',
    name: 'Neema Kileo',
    role: 'admin',
    password: adminHash,
  });

  /* ---------------- partners ---------------- */
  console.log('  Creating partners...');
  const individuals = [
    {
      first: 'Amina',
      last: 'Hassan',
      code: 'AMINA07',
      email: 'amina@demo.pazo.co.tz',
      phone: '+255754892001',
      weight: 1.0,
      days: 95,
    },
    {
      first: 'David',
      last: 'Kipanga',
      code: 'DAVID55',
      email: 'david@demo.pazo.co.tz',
      phone: '+255755440233',
      weight: 0.7,
      days: 78,
    },
    {
      first: 'Grace',
      last: 'Mollel',
      code: 'GRACE21',
      email: 'grace@demo.pazo.co.tz',
      phone: '+255713208877',
      weight: 0.5,
      days: 54,
    },
    {
      first: 'Baraka',
      last: 'Ngowi',
      code: 'BARAKA9',
      email: 'baraka@demo.pazo.co.tz',
      phone: '+255786110455',
      weight: 0.3,
      days: 26,
    },
  ];

  const institutions = [
    {
      org: 'Serena Hotel Dar es Salaam',
      code: 'SERENA24',
      email: 'serena@demo.pazo.co.tz',
      contact: 'Fatma Abdallah',
      phone: '+255222118000',
      industry: 'Hospitality',
      bank: 'CRDB Bank',
      account: '0152847391200',
      weight: 1.2,
      days: 110,
    },
    {
      org: 'Kilimanjaro International Airport',
      code: 'KILIAIR',
      email: 'kia@demo.pazo.co.tz',
      contact: 'Emmanuel Shirima',
      phone: '+255272554252',
      industry: 'Transport',
      bank: 'NMB Bank',
      account: '20901447722',
      weight: 0.9,
      days: 88,
    },
    {
      org: 'Tanzania Tourism Board',
      code: 'TZBRD',
      email: 'ttb@demo.pazo.co.tz',
      contact: 'Neema Mushi',
      phone: '+255222664878',
      industry: 'Government',
      bank: 'NBC Bank',
      account: '011103004455',
      weight: 0.6,
      days: 64,
    },
  ];

  const partners = [];

  for (const p of individuals) {
    const createdAt = Date.now() - p.days * 86400000;
    const userId = await mkUser({
      email: p.email,
      phone: p.phone,
      name: `${p.first} ${p.last}`,
      role: 'individual',
      createdAt,
    });
    await q(
      `INSERT INTO individual_profiles
         (id, user_id, first_name, last_name, whatsapp_number, mobile_money_number,
          mobile_money_provider, mobile_money_verified, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [uuid(), userId, p.first, p.last, p.phone, p.phone, pick(['M-Pesa', 'Tigo Pesa', 'Airtel Money']), dt(createdAt)],
    );
    const partnerId = uuid();
    await q(
      `INSERT INTO partners (id, user_id, business_id, partner_type, referral_code, status, created_at)
       VALUES (?, ?, ?, 'individual', ?, 'active', ?)`,
      [partnerId, userId, businessId, p.code, dt(createdAt)],
    );
    partners.push({ ...p, id: partnerId, userId, type: 'individual', createdAt });
  }

  for (const p of institutions) {
    const createdAt = Date.now() - p.days * 86400000;
    const userId = await mkUser({
      email: p.email,
      name: p.org,
      role: 'institution',
      createdAt,
    });
    await q(
      `INSERT INTO institution_profiles
         (id, user_id, organisation_name, industry_type, contact_person_name, contact_phone,
          payout_method, payout_account, payout_bank_name, payout_account_verified, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'bank', ?, ?, 1, ?)`,
      [uuid(), userId, p.org, p.industry, p.contact, p.phone, p.account, p.bank, dt(createdAt)],
    );
    const partnerId = uuid();
    await q(
      `INSERT INTO partners (id, user_id, business_id, partner_type, referral_code, status, created_at)
       VALUES (?, ?, ?, 'institution', ?, 'active', ?)`,
      [partnerId, userId, businessId, p.code, dt(createdAt)],
    );
    partners.push({ ...p, id: partnerId, userId, type: 'institution', createdAt });
  }

  // One suspended partner so the status filters have something to show.
  const suspendedUser = await mkUser({
    email: 'suspended@demo.pazo.co.tz',
    phone: '+255762334100',
    name: 'Hamisi Juma',
    role: 'individual',
    createdAt: Date.now() - 60 * 86400000,
  });
  await q(
    `INSERT INTO individual_profiles (id, user_id, first_name, last_name, whatsapp_number, mobile_money_number, mobile_money_verified)
     VALUES (?, ?, 'Hamisi', 'Juma', '+255762334100', '+255762334100', 1)`,
    [uuid(), suspendedUser],
  );
  await q(
    `INSERT INTO partners (id, user_id, business_id, partner_type, referral_code, status, total_referrals, total_earnings_tzs, created_at)
     VALUES (?, ?, ?, 'individual', 'HAMISI3', 'suspended', 4, 9868, ?)`,
    [uuid(), suspendedUser, businessId, dt(Date.now() - 60 * 86400000)],
  );
  await q("UPDATE users SET status = 'suspended' WHERE id = ?", [suspendedUser]);

  /* ---------------- pending applications ---------------- */
  console.log('  Creating pending institution applications...');
  const pendingApps = [
    {
      org: 'Zanzibar Beach Resort',
      contact: 'Salma Haji',
      email: 'salma@zanzibarbeach.co.tz',
      phone: '+255242233100',
      industry: 'Hospitality',
      bank: 'CRDB Bank',
      account: '0152998877001',
      days: 1,
    },
    {
      org: 'Arusha Safari Adventures',
      contact: 'Peter Laizer',
      email: 'peter@arushasafari.co.tz',
      phone: '+255754661200',
      industry: 'Tourism',
      bank: 'NMB Bank',
      account: '20904455331',
      days: 2,
    },
  ];
  for (const a of pendingApps) {
    await q(
      `INSERT INTO institution_applications
         (id, business_id, organisation_name, industry_type, contact_person_name, contact_email,
          contact_phone, payout_method, payout_account, payout_bank_name, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'bank', ?, ?, 'pending', ?)`,
      [
        uuid(),
        businessId,
        a.org,
        a.industry,
        a.contact,
        a.email,
        a.phone,
        a.account,
        a.bank,
        dt(Date.now() - a.days * 86400000),
      ],
    );
  }

  /* ---------------- referrals + transactions ---------------- */
  console.log('  Generating 3 months of referral and transaction history...');
  const COMMISSION_RATE = 0.08;
  const FEE_RATE = 0.01;
  let touristCounter = 8000;
  const walletEntries = [];
  const notifications = [];
  let walletBalance = 7_800_000; // opening float before deductions

  for (const partner of partners) {
    const activeDays = Math.min(partner.days, 100);
    const referralCount = Math.round(activeDays * 0.38 * partner.weight) + 3;
    let partnerEarnings = 0;
    let partnerReferrals = 0;

    for (let i = 0; i < referralCount; i += 1) {
      const signupOffset = rand(0, activeDays - 1);
      const signupAt = Date.now() - signupOffset * 86400000 - rand(0, 23) * 3600000;
      const referralId = uuid();
      const touristId = `tvl_${(touristCounter += 1)}`;
      partnerReferrals += 1;

      // 72% of referrals go on to buy at least once.
      const purchases = chance(0.72) ? rand(1, 4) : 0;
      let firstPurchaseAt = null;
      let totalValue = 0;

      // The referral row must exist before its transactions reference it.
      await q(
        `INSERT INTO referrals
           (id, partner_id, business_id, tourist_external_id, signup_date, total_purchases,
            total_value_tzs, status, created_at)
         VALUES (?, ?, ?, ?, ?, 0, 0, 'referred', ?)`,
        [referralId, partner.id, businessId, touristId, dt(signupAt), dt(signupAt)],
      );

      // Top-ups are spread between the signup and today rather than projected
      // forward by a fixed step, which would push most of them past today and
      // leave the recent weeks empty.
      const windowMs = Math.max(3600000, Date.now() - signupAt);
      for (let pIdx = 0; pIdx < purchases; pIdx += 1) {
        const bundle = pick(BUNDLES);
        const purchaseAt =
          pIdx === 0
            ? signupAt + rand(1, 8) * 3600000
            : signupAt + Math.floor((windowMs * (pIdx + rand(0, 60) / 100)) / (purchases + 0.4));
        if (purchaseAt > Date.now()) continue;
        if (!firstPurchaseAt || purchaseAt < firstPurchaseAt) firstPurchaseAt = purchaseAt;

        const commission = Math.round(bundle.price * COMMISSION_RATE);
        const fee = Math.round(bundle.price * FEE_RATE);
        totalValue += bundle.price;

        // A handful of recent commissions stay pending to exercise the monitor.
        const daysAgo = (Date.now() - purchaseAt) / 86400000;
        const isPending = daysAgo < 4 && chance(0.18);
        const status = isPending ? 'pending' : 'paid';
        const txId = uuid();

        await q(
          `INSERT INTO transactions
             (id, referral_id, partner_id, business_id, external_tx_ref, bundle_type, transaction_type,
              amount_tzs, commission_tzs, platform_fee_tzs, commission_rate_applied,
              commission_status, paid_at, webhook_received_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            txId,
            referralId,
            partner.id,
            businessId,
            `TVL-${String(rand(100000, 999999))}`,
            bundle.name,
            pIdx === 0 ? 'first_purchase' : 'topup',
            bundle.price,
            commission,
            fee,
            COMMISSION_RATE,
            status,
            status === 'paid' ? dt(purchaseAt) : null,
            dt(purchaseAt),
            dt(purchaseAt),
          ],
        );

        if (status === 'paid') {
          partnerEarnings += commission;
          walletBalance -= commission;
          walletEntries.push({
            type: 'commission',
            amount: -commission,
            balance: walletBalance,
            description: `Commission — ${bundle.name}`,
            txId,
            at: purchaseAt,
          });
          if (daysAgo < 30) {
            notifications.push({
              userId: partner.userId,
              type: partner.type === 'individual' ? 'commission_paid' : 'commission_accrued',
              title: partner.type === 'individual' ? 'Commission earned' : 'Commission added',
              message:
                partner.type === 'individual'
                  ? `You earned TZS ${commission.toLocaleString('en-US')} on a ${bundle.name} — ${new Date(purchaseAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
                  : `Commission of TZS ${commission.toLocaleString('en-US')} added to your monthly balance — ${new Date(purchaseAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`,
              at: purchaseAt,
            });
          }
        } else {
          notifications.push({
            userId: partner.userId,
            type: 'commission_pending',
            title: 'Commission pending',
            message: `A commission of TZS ${commission.toLocaleString('en-US')} is pending. It will be paid when available.`,
            at: purchaseAt,
          });
        }
      }

      await q(
        `UPDATE referrals
            SET first_purchase_date = ?, total_purchases = ?, total_value_tzs = ?, status = ?
          WHERE id = ?`,
        [
          firstPurchaseAt ? dt(firstPurchaseAt) : null,
          purchases,
          totalValue,
          firstPurchaseAt ? 'active' : 'referred',
          referralId,
        ],
      );
    }

    // Link clicks: roughly 6-9x the signups, so conversion reads believably.
    const clicks = Math.round(partnerReferrals * rand(6, 9));
    for (let c = 0; c < clicks; c += 1) {
      await q(
        'INSERT INTO referral_clicks (partner_id, source, created_at) VALUES (?, ?, ?)',
        [
          partner.id,
          pick(['link', 'qr', 'whatsapp', 'instagram']),
          dt(Date.now() - rand(0, activeDays) * 86400000 - rand(0, 86400000)),
        ],
      );
    }

    await q(
      'UPDATE partners SET total_referrals = ?, total_clicks = ?, total_earnings_tzs = ?, last_active_at = ? WHERE id = ?',
      [partnerReferrals, clicks, partnerEarnings, dt(Date.now() - rand(0, 3) * 86400000), partner.id],
    );

    partner.earnings = partnerEarnings;
  }

  /* ---------------- individual wallets + withdrawals ---------------- */
  console.log('  Creating withdrawals and wallet balances...');
  for (const p of partners.filter((x) => x.type === 'individual')) {
    const earned = p.earnings || 0;
    // Most agents have withdrawn part of what they earned.
    const withdrawalCount = rand(1, 3);
    let withdrawn = 0;

    for (let i = 0; i < withdrawalCount; i += 1) {
      const maxOut = Math.floor((earned - withdrawn) * 0.55);
      if (maxOut < 5000) break;
      const amount = Math.round(rand(5000, maxOut) / 500) * 500;
      const requestedAt = Date.now() - rand(2, 60) * 86400000;
      const isLast = i === withdrawalCount - 1;
      const status = isLast && chance(0.35) ? 'processing' : 'completed';
      withdrawn += amount;

      await q(
        `INSERT INTO withdrawals
           (id, partner_id, amount_tzs, fee_tzs, mobile_money_number, beneficiary_name,
            channel_provider, status, provider, order_reference, provider_reference,
            provider_status, requested_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'clickpesa', ?, ?, ?, ?, ?)`,
        [
          uuid(),
          p.id,
          amount,
          // ClickPesa charges a small flat-ish mobile money fee.
          status === 'completed' ? 1000 : 0,
          p.phone,
          `${p.first} ${p.last}`,
          pick(['M-PESA', 'TIGO-PESA', 'AIRTEL-MONEY']),
          status,
          `PO${Date.now().toString(36).toUpperCase().slice(-8)}${rand(1000, 9999)}`,
          status === 'completed' ? `CP-${String(rand(100000, 999999))}` : null,
          status === 'completed' ? 'SUCCESS' : 'PROCESSING',
          dt(requestedAt),
          status === 'completed' ? dt(requestedAt + 3600000) : null,
        ],
      );
      if (status === 'completed') {
        notifications.push({
          userId: p.userId,
          type: 'withdrawal_complete',
          title: 'Withdrawal sent',
          message: `TZS ${amount.toLocaleString('en-US')} has been sent to your mobile money account.`,
          at: requestedAt + 3600000,
        });
      }
    }

    await q(
      `UPDATE individual_profiles
          SET wallet_balance_tzs = ?, lifetime_earned_tzs = ?, lifetime_withdrawn_tzs = ?
        WHERE user_id = ?`,
      [Math.max(0, earned - withdrawn), earned, withdrawn, p.userId],
    );
  }

  /* ---------------- institution monthly payouts ---------------- */
  console.log('  Creating institution monthly payouts...');
  const now = new Date();
  for (const p of partners.filter((x) => x.type === 'institution')) {
    let remaining = p.earnings || 0;

    // Two completed past months, with the current month left accumulating.
    for (let back = 2; back >= 1; back -= 1) {
      const monthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
      const monthKey = monthDate.toISOString().slice(0, 10);
      const [[agg]] = await conn.execute(
        `SELECT COUNT(*) AS n, COALESCE(SUM(commission_tzs),0) AS commission,
                COALESCE(SUM(amount_tzs),0) AS sales
           FROM transactions
          WHERE partner_id = ? AND commission_status = 'paid'
            AND DATE_FORMAT(created_at, '%Y-%m') = ?`,
        [p.id, monthKey.slice(0, 7)],
      );
      const amount = Number(agg.commission);
      if (amount <= 0) continue;
      remaining -= amount;

      const [[refs]] = await conn.execute(
        `SELECT COUNT(*) AS n FROM referrals WHERE partner_id = ? AND DATE_FORMAT(created_at, '%Y-%m') = ?`,
        [p.id, monthKey.slice(0, 7)],
      );
      const paidAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back + 1, 1, 9, 30));

      await q(
        `INSERT INTO institution_payouts
           (id, partner_id, payout_month, amount_tzs, transaction_count, referral_count,
            sales_total_tzs, payout_account_snapshot, status, reference, processed_by,
            processed_at, completed_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?)`,
        [
          uuid(),
          p.id,
          monthKey,
          amount,
          Number(agg.n),
          Number(refs.n),
          Number(agg.sales),
          `${p.bank} ${p.account}`,
          `PZ-${monthKey.slice(0, 7).replace('-', '')}-${p.code}`,
          superAdminId,
          dt(paidAt),
          dt(paidAt),
          dt(paidAt),
        ],
      );
      notifications.push({
        userId: p.userId,
        type: 'monthly_payout',
        title: 'Monthly payout sent',
        message: `Your monthly payout of TZS ${amount.toLocaleString('en-US')} has been sent to your account — ${paidAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`,
        at: paidAt.getTime(),
      });
    }

    await q(
      'UPDATE institution_profiles SET accumulated_balance_tzs = ?, lifetime_earned_tzs = ? WHERE user_id = ?',
      [Math.max(0, remaining), p.earnings || 0, p.userId],
    );
  }

  /* ---------------- wallet ledger ---------------- */
  console.log('  Writing wallet ledger...');
  const topups = [
    { amount: 3_000_000, daysAgo: 96, ref: 'CRDB-771204' },
    { amount: 2_500_000, daysAgo: 62, ref: 'CRDB-783991' },
    { amount: 2_300_000, daysAgo: 28, ref: 'CRDB-800145' },
  ];
  const ledger = [
    ...topups.map((t) => ({
      type: 'topup',
      amount: t.amount,
      description: `Wallet top-up — bank transfer ref ${t.ref}`,
      at: Date.now() - t.daysAgo * 86400000,
    })),
    ...walletEntries.map((w) => ({
      type: 'commission',
      amount: w.amount,
      description: w.description,
      txId: w.txId,
      at: w.at,
    })),
  ].sort((a, b) => a.at - b.at);

  let running = 0;
  for (const entry of ledger) {
    running += entry.amount;
    await q(
      `INSERT INTO wallet_ledger
         (id, business_id, entry_type, amount_tzs, balance_after_tzs, description, transaction_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuid(), businessId, entry.type, entry.amount, running, entry.description, entry.txId || null, dt(entry.at)],
    );
  }
  await q('UPDATE businesses SET wallet_balance_tzs = ? WHERE id = ?', [running, businessId]);

  /* ---------------- notifications ---------------- */
  console.log('  Writing notifications...');
  notifications.sort((a, b) => a.at - b.at);
  for (const n of notifications.slice(-160)) {
    await q(
      `INSERT INTO notifications (id, user_id, type, title, message, is_read, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [uuid(), n.userId, n.type, n.title, n.message, Date.now() - n.at > 7 * 86400000 ? 1 : 0, dt(n.at)],
    );
  }
  for (const p of partners.slice(0, 7)) {
    await q(
      `INSERT INTO notifications (id, user_id, type, title, message, is_read, created_at)
       VALUES (?, ?, 'welcome', 'Welcome to Pazo', ?, 1, ?)`,
      [
        uuid(),
        p.userId,
        `Welcome to Pazo, ${p.first || p.org}! Your referral code is ${p.code}.`,
        dt(p.createdAt),
      ],
    );
  }
  await q(
    `INSERT INTO notifications (id, user_id, type, title, message, is_read, created_at)
     VALUES (?, ?, 'custom', 'New institution application', 'Zanzibar Beach Resort applied to join the partner programme.', 0, ?)`,
    [uuid(), superAdminId, dt(Date.now() - 86400000)],
  );

  /* ---------------- announcements, templates, audit ---------------- */
  await q(
    `INSERT INTO announcements (id, title, body, audience, variant, active, created_by, created_at)
     VALUES (?, 'New bundles are live', 'East Africa regional bundles are now available on The Travela. Same commission rate, wider coverage — a good reason to reshare your link.', 'all', 'info', 1, ?, ?)`,
    [uuid(), superAdminId, dt(Date.now() - 5 * 86400000)],
  );

  const templates = [
    ['Commission reminder', 'sms', null, 'Hi {name}, you have earned TZS {amount} this month with Pazo. Keep sharing your code {code}.'],
    ['Payout confirmation', 'email', 'Your monthly payout has been sent', 'Hello {name}, your payout of TZS {amount} for {month} has been sent to your registered account. Reference: {reference}.'],
    ['Welcome message', 'in_app', 'Welcome to Pazo', 'Welcome aboard, {name}. Your referral code is {code} — share it anywhere to start earning.'],
  ];
  for (const [name, channel, subject, body] of templates) {
    await q(
      'INSERT INTO message_templates (id, name, channel, subject, body, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      [uuid(), name, channel, subject, body, superAdminId],
    );
  }

  const auditSeed = [
    ['admin.business_created', 'business', 'The Travela onboarded'],
    ['admin.wallet_topup', 'business', 'Wallet topped up by TZS 2,300,000'],
    ['admin.institution_approved', 'partner', 'Tanzania Tourism Board approved'],
    ['admin.payout_batch_processed', 'payout_batch', 'Monthly payouts processed'],
    ['admin.config_updated', 'settings', 'Minimum withdrawal reviewed'],
  ];
  for (let i = 0; i < auditSeed.length; i += 1) {
    const [action, resource, note] = auditSeed[i];
    await q(
      `INSERT INTO audit_log (actor_user_id, actor_name, actor_role, action, resource_type, detail, created_at)
       VALUES (?, 'Pazo Super Admin', 'super_admin', ?, ?, ?, ?)`,
      [superAdminId, action, resource, JSON.stringify({ note }), dt(Date.now() - (i + 1) * 5 * 86400000)],
    );
  }

  const [[txCount]] = await conn.query('SELECT COUNT(*) AS n FROM transactions');
  const [[refCount]] = await conn.query('SELECT COUNT(*) AS n FROM referrals');

  await conn.end();

  console.log(`
  ══════════════════════════════════════════════════════════
   Seed complete
  ══════════════════════════════════════════════════════════
   Referrals:     ${refCount.n}
   Transactions:  ${txCount.n}
   Wallet:        TZS ${running.toLocaleString('en-US')}

   DEMO LOGINS
   ---------------------------------------------------------
   Individual     amina@demo.pazo.co.tz     ${DEMO_PASSWORD}
                  (or phone 0754 892 001)
   Institution    serena@demo.pazo.co.tz    ${DEMO_PASSWORD}
   Business       demo@thetravela.com       ${DEMO_PASSWORD}
   Admin          admin@pazo.co.tz          ${ADMIN_PASSWORD}
   Ops admin      ops@pazo.co.tz            ${ADMIN_PASSWORD}

   THE TRAVELA API KEY (store it now, it is hashed in the DB)
   ${apiKey}
  ══════════════════════════════════════════════════════════
`);
}

main().catch((err) => {
  console.error('\n  Seed failed:', err);
  process.exit(1);
});
