'use strict';

// Pure PDF renderer for expense-claim lists (pdfkit). No DB access — takes rows.
const PDFDocument = require('pdfkit');

const ymd = (d) => (d ? String(d).slice(0, 10) : '');
const money = (v, cur) => {
  const n = Number(v || 0);
  const sym = cur === 'INR' ? 'INR ' : cur === 'GBP' ? 'GBP ' : '';
  return sym + n.toFixed(2);
};

const COLS = [
  { k: 'claimNumber',  t: 'Claim No',  w: 80 },
  { k: 'employeeName', t: 'Employee',  w: 120 },
  { k: 'country',      t: 'Country',   w: 50 },
  { k: 'period',       t: 'Period',    w: 130 },
  { k: 'status',       t: 'Status',    w: 80 },
  { k: 'total',        t: 'Total',     w: 80, align: 'right' },
  { k: 'submittedAt',  t: 'Submitted', w: 75 },
  { k: 'decidedBy',    t: 'Decided By', w: 130 }
];

// rows: [{ claimNumber, employeeName, country, claimPeriod, periodEnd, status,
//          totalGross, currency, submittedAt, decidedBy }]
function renderClaimsPdf(rows = [], opts = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Branded header
    doc.fontSize(18).fillColor('#0a6ed1').text('Bluestone', { continued: true })
       .fillColor('#0a6ed1').text('X', { continued: true })
       .fillColor('#32363a').text('   ' + (opts.title || 'Expense Claims'));
    doc.fontSize(9).fillColor('#6a6d70')
       .text('Generated ' + new Date().toISOString().slice(0, 19).replace('T', ' ') + '  ·  ' + rows.length + ' claim(s)');
    doc.moveDown(0.6);

    const startX = doc.page.margins.left;
    const tableW = COLS.reduce((s, c) => s + c.w, 0);
    let y = doc.y;
    const rowH = 18;
    const bottom = doc.page.height - doc.page.margins.bottom;

    const drawRow = (vals, header) => {
      if (y + rowH > bottom) { doc.addPage(); y = doc.page.margins.top; }
      let x = startX;
      if (header) { doc.rect(x, y, tableW, rowH).fill('#f2f3f5'); }
      doc.fontSize(8.5).fillColor(header ? '#32363a' : '#1c2530');
      COLS.forEach((c) => {
        doc.text(String(vals[c.k] == null ? '' : vals[c.k]), x + 4, y + 5, { width: c.w - 8, align: c.align || 'left', ellipsis: true, lineBreak: false });
        x += c.w;
      });
      doc.moveTo(startX, y + rowH).lineTo(startX + tableW, y + rowH).strokeColor('#e5e5e5').lineWidth(0.5).stroke();
      y += rowH;
    };

    drawRow(Object.fromEntries(COLS.map((c) => [c.k, c.t])), true);
    let grand = 0;
    rows.forEach((r) => {
      grand += Number(r.totalGross || 0);
      drawRow({
        claimNumber: r.claimNumber,
        employeeName: r.employeeName,
        country: r.country,
        period: ymd(r.claimPeriod) + (r.periodEnd ? ' - ' + ymd(r.periodEnd) : ''),
        status: r.status,
        total: money(r.totalGross, r.currency),
        submittedAt: ymd(r.submittedAt),
        decidedBy: r.decidedBy || ''
      }, false);
    });

    if (!rows.length) {
      doc.fontSize(10).fillColor('#6a6d70').text('No claims for the selected filters.', startX, y + 8);
    } else {
      doc.moveDown(0.5).fontSize(9).fillColor('#32363a')
         .text('Total gross across ' + rows.length + ' claim(s): ' + grand.toFixed(2), startX, y + 6);
    }

    doc.end();
  });
}

module.exports = { renderClaimsPdf };
