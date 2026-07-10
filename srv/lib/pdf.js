'use strict';

// Pure PDF renderer for expense claims (pdfkit). No DB access — takes rows.
// Layout: one detail BLOCK per claim (label/value grid) so EVERY claim-level
// field is printed and long text wraps instead of being clipped.
const PDFDocument = require('pdfkit');

const ymd = (d) => (d ? String(d).slice(0, 10) : '');
const dt = (d) => (d ? String(d).slice(0, 19).replace('T', ' ') : '');
const money = (v, cur) => {
  const n = Number(v || 0);
  const sym = cur === 'INR' ? 'INR ' : cur === 'GBP' ? 'GBP ' : '';
  return sym + n.toFixed(2);
};
const str = (v) => (v == null || v === '' ? '—' : String(v));

// Two-column fields (label + value), rendered in a paired grid.
const FIELDS = [
  ['Employee',              (r) => r.employeeName],
  ['Employee #',            (r) => r.employeeNumber],
  ['Country',               (r) => r.country],
  ['Currency',              (r) => r.currency],
  ['Claim Period',          (r) => ymd(r.claimPeriod)],
  ['Period End',            (r) => ymd(r.periodEnd)],
  ['Status',                (r) => r.status],
  ['Payroll Area',          (r) => r.payrollArea],
  ['Net',                   (r) => money(r.totalNet, r.currency)],
  ['Tax',                   (r) => money(r.totalVAT, r.currency)],
  ['Gross',                 (r) => money(r.totalGross, r.currency)],
  ['Submitted On',          (r) => dt(r.submittedAt)],
  ['Level 1 Approved By',   (r) => r.level1ApprovedBy],
  ['Level 1 Approved On',   (r) => dt(r.level1ApprovedAt)],
  ['Level 2 Approved By',   (r) => r.level2ApprovedBy],
  ['Level 2 Approved On',   (r) => dt(r.level2ApprovedAt)],
  ['Returned / Rejected By',(r) => r.rejectedBy],
  ['Created By',            (r) => r.createdBy],
  ['Created At',            (r) => dt(r.createdAt)],
  ['Modified By',           (r) => r.modifiedBy],
  ['Modified At',           (r) => dt(r.modifiedAt)]
];
// Full-width fields (free text that can be long — wraps across the page).
const WIDE = [
  ['Level 1 Comment',            (r) => r.level1Comment],
  ['Level 2 Comment',            (r) => r.level2Comment],
  ['Return / Rejection Reason',  (r) => r.rejectionReason]
];

function renderClaimsPdf(rows = [], opts = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'portrait', margin: 40 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const fullW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const gap = 16;
    const colW = (fullW - gap) / 2;
    const rightX = left + colW + gap;
    const bottom = doc.page.height - doc.page.margins.bottom;

    // Branded header
    doc.fontSize(18).fillColor('#0a6ed1').text('Bluestone', { continued: true })
       .fillColor('#0a6ed1').text('X', { continued: true })
       .fillColor('#32363a').text('   ' + (opts.title || 'Expense Claims'));
    doc.fontSize(9).fillColor('#6a6d70')
       .text('Generated ' + new Date().toISOString().slice(0, 19).replace('T', ' ') + '  ·  ' + rows.length + ' claim(s)');
    let y = doc.y + 10;

    const cellH = (label, val, w) => {
      doc.fontSize(7.5); const lh = doc.heightOfString(label, { width: w });
      doc.fontSize(9);   const vh = doc.heightOfString(str(val), { width: w });
      return lh + vh + 6;
    };
    const drawCell = (x, yy, w, label, val) => {
      doc.fontSize(7.5).fillColor('#6a6d70').text(label, x, yy, { width: w });
      doc.fontSize(9).fillColor('#1c2530').text(str(val), x, doc.y, { width: w });
    };
    const pageBreak = (needed) => { if (y + needed > bottom) { doc.addPage(); y = doc.page.margins.top; } };

    if (!rows.length) {
      doc.fontSize(10).fillColor('#6a6d70').text('No claims for the selected filters.', left, y + 8);
      doc.end();
      return;
    }

    const grand = {};
    rows.forEach((r, idx) => {
      grand[r.currency || ''] = (grand[r.currency || ''] || 0) + Number(r.totalGross || 0);

      // Claim heading
      pageBreak(40);
      doc.fontSize(11).fillColor('#0a6ed1')
         .text(str(r.claimNumber) + '   ·   ' + str(r.status), left, y, { width: fullW });
      y = doc.y + 4;

      // Two-column label/value grid
      for (let i = 0; i < FIELDS.length; i += 2) {
        const f1 = FIELDS[i], f2 = FIELDS[i + 1];
        const v1 = f1[1](r), v2 = f2 ? f2[1](r) : null;
        const h = Math.max(cellH(f1[0], v1, colW), f2 ? cellH(f2[0], v2, colW) : 0);
        pageBreak(h);
        drawCell(left, y, colW, f1[0], v1);
        if (f2) drawCell(rightX, y, colW, f2[0], v2);
        y += h;
      }
      // Full-width free-text fields
      WIDE.forEach((f) => {
        const h = cellH(f[0], f[1](r), fullW);
        pageBreak(h);
        drawCell(left, y, fullW, f[0], f[1](r));
        y += h;
      });

      // Divider between claims
      y += 4;
      if (idx < rows.length - 1) {
        pageBreak(14);
        doc.moveTo(left, y).lineTo(left + fullW, y).strokeColor('#e5e5e5').lineWidth(0.5).stroke();
        y += 12;
      }
    });

    // Currency-separated totals footer (never combined across currencies)
    pageBreak(30);
    y += 8;
    const totals = Object.keys(grand).filter((k) => k).map((k) => money(grand[k], k)).join('   ·   ');
    doc.fontSize(9).fillColor('#32363a')
       .text('Total gross across ' + rows.length + ' claim(s): ' + (totals || '0.00'), left, y, { width: fullW });

    doc.end();
  });
}

module.exports = { renderClaimsPdf };
