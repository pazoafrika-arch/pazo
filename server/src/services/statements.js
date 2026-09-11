/**
 * Monthly institution statements (PRD 3.3 / 6.4).
 *
 * Rendered as a self-contained, print-ready HTML document. The browser's own
 * print-to-PDF produces the PDF, which keeps the server dependency-free and
 * gives a crisper result than a server-side rasteriser. The page opens the
 * print dialog on load when ?print=1 is passed.
 */

const money = (n) => `TZS ${Number(n || 0).toLocaleString('en-US')}`;

const monthName = (month) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

const dayStamp = (d) =>
  new Date(d).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

export function buildStatementHtml({
  month,
  organisation,
  referralCode,
  businessName,
  payoutAccount,
  rows,
  payout,
}) {
  const totalSales = rows.reduce((sum, r) => sum + Number(r.amount_tzs), 0);
  const totalCommission = rows.reduce((sum, r) => sum + Number(r.commission_tzs), 0);
  const firstPurchases = rows.filter((r) => r.transaction_type === 'first_purchase').length;
  const topups = rows.length - firstPurchases;

  const bodyRows = rows
    .map(
      (r) => `
      <tr>
        <td>${dayStamp(r.created_at)}</td>
        <td>${escapeHtml(r.bundle_type || '—')}</td>
        <td>${r.transaction_type === 'topup' ? 'Top-up' : 'First purchase'}</td>
        <td class="num">${money(r.amount_tzs)}</td>
        <td class="num strong">${money(r.commission_tzs)}</td>
      </tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Pazo statement — ${escapeHtml(organisation)} — ${monthName(month)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Inter',system-ui,-apple-system,'Segoe UI',sans-serif;color:#0D2137;background:#F0FAFA;padding:32px 20px}
  .sheet{max-width:820px;margin:0 auto;background:#fff;border:1px solid rgba(13,33,55,.1);border-radius:16px;overflow:hidden}
  .head{padding:28px 32px;background:linear-gradient(135deg,#0D2137,#0F3460);color:#fff}
  .eyebrow{font-size:11px;letter-spacing:1.6px;text-transform:uppercase;color:rgba(255,255,255,.55);font-weight:700}
  h1{font-size:24px;font-weight:800;letter-spacing:-.5px;margin:6px 0 4px}
  .sub{font-size:13px;color:rgba(255,255,255,.6)}
  .meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:16px;padding:22px 32px;border-bottom:1px solid rgba(13,33,55,.08)}
  .meta div span{display:block;font-size:11px;color:#7A9AAA;font-weight:600;text-transform:uppercase;letter-spacing:.6px;margin-bottom:3px}
  .meta div strong{font-size:14px;font-weight:600}
  .totals{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;padding:22px 32px}
  .tcard{background:#F0FAFA;border:1px solid rgba(13,33,55,.07);border-radius:12px;padding:16px}
  .tcard span{display:block;font-size:11.5px;color:#7A9AAA;font-weight:600;margin-bottom:5px}
  .tcard strong{font-size:19px;font-weight:800;letter-spacing:-.5px}
  .tcard.accent strong{color:#01989f}
  table{width:100%;border-collapse:collapse;font-size:13px}
  thead th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.7px;color:#7A9AAA;padding:12px 32px;background:#F8FAFC;border-top:1px solid rgba(13,33,55,.08);border-bottom:1px solid rgba(13,33,55,.08)}
  tbody td{padding:12px 32px;border-bottom:1px solid #F1F5F9}
  tbody tr:last-child td{border-bottom:none}
  .num{text-align:right;font-variant-numeric:tabular-nums}
  .strong{font-weight:700;color:#01989f}
  tfoot td{padding:16px 32px;font-weight:800;border-top:2px solid rgba(13,33,55,.1)}
  .status{display:inline-block;font-size:11px;font-weight:700;padding:4px 10px;border-radius:20px}
  .paid{background:#ECFDF5;color:#059669}
  .upcoming{background:#EAF7F7;color:#01989f}
  .foot{padding:20px 32px;font-size:11.5px;color:#7A9AAA;line-height:1.6;border-top:1px solid rgba(13,33,55,.08)}
  .actions{max-width:820px;margin:0 auto 16px;text-align:right}
  button{background:#0D2137;color:#fff;border:none;border-radius:50px;padding:10px 22px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit}
  @media print{body{background:#fff;padding:0}.sheet{border:none;border-radius:0}.actions{display:none}}
  @media (max-width:640px){
    body{padding:16px 10px}
    .head,.meta,.totals{padding-left:18px;padding-right:18px}
    thead th,tbody td,tfoot td{padding-left:18px;padding-right:18px}
    h1{font-size:20px}
  }
</style>
</head>
<body>
<div class="actions"><button onclick="window.print()">Download / print statement</button></div>
<div class="sheet">
  <div class="head">
    <div class="eyebrow">Pazo partner statement</div>
    <h1>${monthName(month)}</h1>
    <div class="sub">${escapeHtml(organisation)} · ${escapeHtml(businessName)} partner programme</div>
  </div>

  <div class="meta">
    <div><span>Referral code</span><strong>${escapeHtml(referralCode)}</strong></div>
    <div><span>Payout account</span><strong>${escapeHtml(payoutAccount || '—')}</strong></div>
    <div><span>Statement period</span><strong>${monthName(month)}</strong></div>
    <div><span>Payout status</span><strong>${
      payout && payout.status === 'completed'
        ? `<span class="status paid">Paid ${dayStamp(payout.completed_at || payout.processed_at)}</span>`
        : '<span class="status upcoming">Upcoming</span>'
    }</strong></div>
  </div>

  <div class="totals">
    <div class="tcard"><span>Transactions</span><strong>${rows.length}</strong></div>
    <div class="tcard"><span>First purchases</span><strong>${firstPurchases}</strong></div>
    <div class="tcard"><span>Top-ups</span><strong>${topups}</strong></div>
    <div class="tcard"><span>Sales generated</span><strong>${money(totalSales)}</strong></div>
    <div class="tcard accent"><span>Commission earned</span><strong>${money(totalCommission)}</strong></div>
  </div>

  <table>
    <thead><tr><th>Date</th><th>Bundle</th><th>Type</th><th class="num">Sale</th><th class="num">Commission</th></tr></thead>
    <tbody>${bodyRows}</tbody>
    <tfoot><tr><td colspan="3">Total</td><td class="num">${money(totalSales)}</td><td class="num strong">${money(totalCommission)}</td></tr></tfoot>
  </table>

  <div class="foot">
    This statement covers commissions earned through the ${escapeHtml(businessName)} partner programme.
    No customer personal data is included, in line with Pazo's privacy policy.
    Questions? Email partners@pazo.co.tz.
  </div>
</div>
<script>
  if (new URLSearchParams(location.search).get('print') === '1') window.print();
</script>
</body>
</html>`;
}
